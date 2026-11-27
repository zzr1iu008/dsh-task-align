/**
 * dsh-task-align — Host half.
 *
 * Inserts an "understanding gate" at the start of a complex task the human sent
 * in the Web GUI: the model restates what it understood and waits for the
 * user's confirmation, and no other tool runs until that gate opens. An
 * unanswered gate opens by itself after a timeout and is reported as
 * unconfirmed. A progress tool keeps the current step visible while work runs.
 *
 * The package is installed as a linked workspace directory, so it carries no
 * dependencies and imports nothing: every capability arrives through `ctx`.
 *
 * @module dsh-task-align
 */

export const name = 'task-align'

/** Services this plugin needs; without them it stays inactive instead of throwing. */
export const inject = ['tools', 'systemPrompt', 'commands', 'sessionProjections']

const CONFIRM_TOOL = 'confirm_task_understanding'
const PROGRESS_TOOL = 'update_task_progress'

/**
 * Tools the guard must never deny. In the PTC execution mode the only top-level
 * tool is `run_code`, and every other tool — the confirmation tool included —
 * is reached from inside a program. Blocking the executor therefore deadlocks
 * the session outright: the model cannot confirm because confirming needs
 * `run_code`, and `run_code` is denied because the task is not confirmed.
 */
const EXECUTOR_TOOLS = new Set(['run_code'])

const DEFAULTS = {

  /** Whether the progress tool is registered at all. */
  progressTool: true,
  /** Whether the gate is active; false disables the plugin's behavior entirely. */
  enabled: true,

}

/**
 * Concatenate the text blocks of one model-visible user message.
 * @param message - a user message from the pre-step batch.
 * @returns its plain text.
 */
function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks.filter(block => block?.type === 'text').map(block => String(block.text ?? '')).join('\n')
}

/**
 * The gate is armed on every human message and stays closed until a plan is
 * confirmed. There is deliberately no content heuristic: what matters is that
 * the agent is about to touch something, not how the request was worded.
 * A turn that only answers in prose never calls a tool, so it never asks.
 */

/**
 * Register the gate, its tools, and the prompt rule.
 * @param ctx - registrant context carrying tools, user questions, and the prompt registry.
 * @param config - row configuration; every field falls back to {@link DEFAULTS}.
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  if (cfg.enabled === false) return
  /** Per-agent gate: `closed` blocks every tool except the confirm tool. */
  const gates = new WeakMap()
  /** Plan of record per agent, so the progress tool can count what is left. */
  const plans = new WeakMap()
  /** The confirmation currently outstanding for one agent, resolved by the command. */
  const waiters = new WeakMap()
  /** The last plan the user approved, so a later turn of the same task needs no card. */
  const approved = new WeakMap()
  /** Consecutive denials per agent; the cap keeps a broken gate from bricking a session. */
  const denials = new WeakMap()

  /**
   * Durable copy of the plan, folded out of the session log by a host-only
   * projection. Memory stays the fast path; this is what a reload reads back so
   * the step count and the approved plan survive.
   */
  // Explicit state of one task, folded out of the session log. Nothing in the
  // client infers a decision any more: the gate call says "awaiting", the
  // `/task-align` command says how it ended, the progress tool says per-step.
  const EMPTY_PLAN = {
    restatement: '',
    steps: [],
    status: 'idle',
    callId: '',
    revision: false,
    decidedBy: '',
  }
  const passThrough = { parse: value => value }
  let planHandle = null

  /**
   * Normalise the arguments a tool call carried: a plain call logs a JSON string,
   * a PTC dispatch may log the object itself.
   * @param raw - arguments from the event.
   * @returns the parsed object, or null.
   */
  const argsOf = raw => {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    return raw !== null && typeof raw === 'object' ? raw : null
  }

  /**
   * Read one tool call out of either lifecycle: native logs `tool/call`, PTC
   * sessions log the nested call as `tool/ptc-dispatch` with a `subCallId`.
   * @param event - a session event.
   * @returns the call's name, raw arguments and id, or null.
   */
  const toolCallOf = event => {
    const data = event.data
    if (data === undefined || data === null) return null
    if (event.type === 'tool/call') {
      return { name: data.name, raw: data.arguments, callId: String(data.callId ?? '') }
    }
    if (event.type === 'tool/ptc-dispatch') {
      return { name: data.name, raw: data.arguments, callId: String(data.subCallId ?? '') }
    }
    return null
  }

  const foldPlan = (state, event) => {
    const call = toolCallOf(event)

    // The gate call opens a task, or keeps the approved one while a turn merely
    // continues it: `needsConfirmation: false` is an explicit continuation.
    if (call !== null && call.name === CONFIRM_TOOL) {
      const args = argsOf(call.raw)
      if (args === null) return state
      const steps = Array.isArray(args.steps) ? args.steps.map(String).filter(t => t.trim() !== '') : []
      const restatement = String(args.restatement ?? '').trim()
      // Nothing to show is not a card: a bare continuation call must never
      // replace the plan with an empty one (that is what produced a card with
      // an empty body).
      if (steps.length === 0 && restatement === '') return state
      const continues = args.needsConfirmation === false && args.isRevision !== true
      if (continues && (state.status === 'approved' || state.status === 'edited')) {
        return { ...state, callId: call.callId === '' ? state.callId : call.callId }
      }
      return {
        restatement,
        steps: steps.map(text => ({ text, status: 'todo' })),
        status: 'awaiting',
        callId: call.callId,
        revision: args.isRevision === true,
        decidedBy: '',
      }
    }

    if (call !== null && call.name === PROGRESS_TOOL) {
      const args = argsOf(call.raw)
      if (args === null) return state
      const index = Number(args.step) - 1
      if (!Number.isInteger(index) || index < 0 || index >= state.steps.length) return state
      const status = String(args.status)
      // Reporting a LATER step proves the earlier one is settled: a model that
      // forgets to close step N must not leave it "in progress" forever.
      return {
        ...state,
        steps: state.steps.map((step, i) => {
          if (i === index) return { ...step, status }
          if (i < index && step.status === 'doing') return { ...step, status: 'done' }
          return step
        }),
      }
    }

    // `/task-align confirm|edit …|decline|done` — the decision itself, recorded
    // by the command, so no marker parsing and no "did the user click" guessing.
    if (event.type === 'command/run' && event.data?.name === 'task-align') {
      const text = String(event.data.args ?? '').trim()
      if (/^(done|finish|完成|结束|收工)$/i.test(text)) {
        return { ...state, status: 'done', decidedBy: 'done' }
      }
      if (/^(decline|cancel|no|n|取消|不|停)$/i.test(text)) {
        return { ...state, status: 'declined', decidedBy: 'decline' }
      }
      const edit = text.match(/^edit\s+([\s\S]+)$/i)
      if (edit !== null) {
        const lines = edit[1].split('\n').map(line => line.trim()).filter(line => line.length > 0)
        const steps = lines.length > 1
          ? lines.slice(1).map(step => ({ text: step, status: 'todo' }))
          : state.steps.map(step => ({ text: step.text, status: step.status }))
        return {
          ...state,
          restatement: lines[0] ?? state.restatement,
          steps,
          status: 'edited',
          decidedBy: 'edit',
        }
      }
      if (text === '' || /^(confirm|ok|yes|y|确认|确认开工|开始|好)$/i.test(text)) {
        return { ...state, status: 'approved', decidedBy: 'confirm' }
      }
      return state
    }

    return state
  }

  // Registered out of the activation path so `apply` stays synchronous; a
  // failure only costs durability, never the gate.
  ctx.effect(() => {
    let disposed = false
    Promise.resolve()
      .then(() => ctx.sessionProjections.register({
        key: 'taskAlignPlan',
        stateSchema: passThrough,
        init: () => EMPTY_PLAN,
        apply: foldPlan,
        stateVersion: 2,
        wire: {
          viewSchema: passThrough,
          view: state => state,
        },
      }))
      .then(handle => {
        if (disposed) {
          Promise.resolve(handle.dispose()).catch(() => {})
          return
        }
        planHandle = handle
      })
      .catch(error => {
        ctx.logger?.warn?.('[task-align] plan projection unavailable, falling back to memory only', error)
      })
    return () => {
      disposed = true
      if (planHandle !== null) {
        Promise.resolve(planHandle.dispose()).catch(() => {})
        planHandle = null
      }
    }
  }, 'task-align:plan-projection')

  /** The durable plan for one agent, or undefined when the log has none. */
  const durablePlan = agent => {
    if (planHandle === null) return undefined
    try {
      const state = planHandle.stateOf(agent.session)
      return state === undefined || state.status === 'idle' ? undefined : state
    } catch {
      return undefined
    }
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'task-align:gate-rule',
    order: 640,
    text: () => [
      `Call \`${CONFIRM_TOOL}\` once when a NEW task begins, with the overall restatement and a 3-5 step plan.`
      + ' It returns immediately with status awaiting: when that happens, show the plan to the user in your message',
      ' and END YOUR TURN. Do not retry tools — every tool stays blocked until the user answers, and their answer',
      ' starts your next turn. Later turns of the same approved task pass needsConfirmation false so nothing is',
      ' asked twice. Passing false after a task ended (confirm-then-done) cannot skip the card: that is a NEW',
      ' task, so pass true. Load the `task-align-plan` skill for a multi-step task.',
      `Report every plan step with \`${PROGRESS_TOOL}\`: status \`doing\` the moment you START it (before that step's`,
      ' tools), then \`done\` when it finishes. Report even when a step is a single tool call — skipping the report',
      ' leaves the progress line above the composer stuck on "未上报进度", which reads to the user as if nothing is',
      ' happening. Never report a step you have not started, and never batch several steps at the end.',
      'In a code-execution (PTC) session the whole task can live inside one program: emit the report from inside',
      'that program at each step boundary, before and after that step\'s work — reporting once after the program',
      'finishes shows the user nothing for minutes and then jumps straight to the end.',
      'When the user adds or changes a requirement while you are working, stop, restate the WHOLE updated plan',
      '(previous steps plus the change, and say what changed) with isRevision true, then end your turn again.',
      'If a result reports the gate opened without confirmation, say so plainly in your next message.',
    ].join(' '),
  }), 'task-align:prompt')

  if (cfg.progressTool !== false) {
    ctx.tools.register({
      name: PROGRESS_TOOL,
      description: [
        'Call this at the START of each plan step (status doing) and again when it finishes (status done).',
        'The line above the composer shows this to the user; without the call it stays on "未上报进度".',
        'Report single-tool steps too, and never batch several steps into one report at the end.',
      ].join(' '),
      parameters: {
        step: { type: 'integer', required: true, description: 'The 1-based plan step this update is about.' },
        status: {
          type: 'string', required: true, enum: ['doing', 'done', 'skipped'],
          description: 'doing (started now) | done (finished) | skipped (no longer needed).',
        },
        note: { type: 'string', description: 'One short line about what happened in this step.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          required: ['acknowledged', 'step', 'status', 'remaining'],
          properties: {
            acknowledged: { type: 'boolean' },
            step: { type: 'integer' },
            status: { type: 'string' },
            remaining: { type: 'integer' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.remaining > 0
            ? `Step ${value.step} ${value.status}; ${value.remaining} step(s) left.`
            : `Step ${value.step} ${value.status}; every plan step has been reported.`,
        }],
      },
      execute(args, exec) {
        let plan = exec.agent ? plans.get(exec.agent) : undefined
        if (plan === undefined && exec.agent) {
          const durable = durablePlan(exec.agent)
          if (durable !== undefined) {
            plan = { restatement: durable.restatement, steps: durable.steps.map(step => ({ ...step })) }
            plans.set(exec.agent, plan)
          }
        }
        const index = Number(args.step) - 1
        const total = Array.isArray(plan?.steps) ? plan.steps.length : 0
        if (plan !== undefined && index >= 0 && index < total) {
          plan.steps[index].status = args.status
          if (typeof args.note === 'string') plan.steps[index].note = args.note
        }
        return Promise.resolve({
          acknowledged: true,
          step: Number(args.step),
          status: String(args.status),
          remaining: Math.max(0, total - Number(args.step)),
        })
      },
      presentCall: args => ({ card: 'generic', title: `Step ${args.step}: ${args.status}`, kind: 'other', rawInput: args }),
    })
  }

  /** The gate body, hoisted so the tool method can call it by name. */
  const runGate = async (args, exec) => {
      if (!exec.agent) throw new Error(`${CONFIRM_TOOL} requires an owning agent session`)
      const steps = (Array.isArray(args.steps) ? args.steps : [])
        .map(step => String(step).trim())
        .filter(step => step.length > 0)
        .slice(0, 8)
      const restatement = String(args.restatement ?? '').trim()
      const record = { restatement, steps: steps.map(text => ({ text, status: 'todo' })) }
      plans.set(exec.agent, record)

      // A nested dispatch runs inside `run_code` (PTC mode). It used to bail out
      // here because a blocking gate could not be interrupted without hanging a
      // session that had nothing on screen. The gate no longer blocks, and the
      // chat client already folds `tool/ptc-dispatch` into ordinary tool nodes,
      // so a PTC call now records the plan and shows the card like any other.
      // It cannot force the model to stop: `run_code` stays allowed so that a
      // PTC session never deadlocks, which leaves pausing to the prompt.

      // A turn continues an already-approved task, so no new card is needed.
      // The first task of a session still shows one: with no approved plan there
      // is nothing to continue, and `false` cannot be used to skip the card.
      if (exec.signal?.aborted) {
        gates.set(exec.agent, { state: 'open' })
        return {
          status: 'aborted',
          confirmed: false,
          unconfirmed: false,
          declined: false,
          restatement: record.restatement,
          steps: record.steps.map(step => step.text),
        }
      }

      // A call with nothing to show cannot open a card. Refuse it loudly so the
      // model retries as a real task instead of leaving an empty card on screen.
      if (steps.length === 0 && restatement === '') {
        gates.set(exec.agent, { state: 'open' })
        throw new Error(`${CONFIRM_TOOL} needs a restatement and 3-5 steps to show the user; `
          + 'a call with neither is refused. If this turn merely continues an approved plan, '
          + 'pass needsConfirmation false together with that plan\'s restatement and steps.')
      }

      if (args.needsConfirmation === false && args.isRevision !== true) {
        if (approved.get(exec.agent) === undefined) {
          const durable = durablePlan(exec.agent)
          // 'approved' is what a continuation records now; the other two are
          // kept for sessions written by the older, blocking design.
          if (durable !== undefined
            && (durable.status === 'approved' || durable.status === 'edited'
              || durable.status === 'confirmed')) {
            approved.set(exec.agent, { restatement: durable.restatement, steps: durable.steps })
          }
        }
        const plan = approved.get(exec.agent)
        if (plan !== undefined) {
          gates.set(exec.agent, { state: 'open' })
          return {
            status: 'approved',
            confirmed: false,
            unconfirmed: false,
            declined: false,
            restatement: plan.restatement,
            steps: plan.steps.map(step => step.text),
          }
        }
      }

      // Two concurrent gate calls for one agent would each overwrite the other's
      // waiter, leaving one to hang until its timeout. Refuse the second instead.
      if (waiters.has(exec.agent)) {
        throw new Error(`${CONFIRM_TOOL} is already waiting for a decision in this session; `
          + 'a blocked call is not a failure to retry, it means the gate is still closed.')
      }

      const planLines = record.steps.map((step, index) => `${index + 1}. ${step.text}`).join('\n')

      // The gate waits on this plugin's own waiter, not on the user-questions
      // waterfall: a question sent through that waterfall is invisible whenever
      // the profile answers nothing, and a silently empty answer must never be
      // read as consent. The `/task-align` command or the timeout settle it.
      // Non-blocking by design. A call that waits for a click is aborted the
      // moment the user types, which is also what made the card disappear. The
      // request is recorded instead, the gate stays closed, and `/task-align`
      // opens it; the button that settles it no longer lives inside a tool call.
      waiters.set(exec.agent, { callId: exec.callId, record, decision: undefined })
      gates.set(exec.agent, { state: 'closed' })
      ctx.logger?.info?.(
        `[task-align] awaiting confirmation callId=${String(exec.callId)}. `
        + 'Confirm with /task-align confirm, correct with /task-align edit <text>, refuse with /task-align decline. '
        + `Restatement: ${restatement} | Plan: ${planLines}`,
      )

      return {
        status: 'awaiting',
        confirmed: false,
        unconfirmed: false,
        declined: false,
        restatement: record.restatement,
        steps: record.steps.map(step => step.text),
      }
  }

  ctx.tools.register({
    name: CONFIRM_TOOL,
    description: [
      'Call this once when a NEW task begins: restate the overall task with a 3-5 step plan. It returns',
      'status awaiting immediately and blocks every other tool; show the plan to the user, end your turn,',
      'and continue when their answer starts the next turn. Set needsConfirmation false only when this turn',
      'continues a plan the user already approved. Passing false before any plan is approved is refused.',
    ].join(' '),
    parameters: {
      restatement: {
        type: 'string', required: true,
        description: 'One sentence: what you understood the user to be asking for.',
      },
      steps: {
        type: 'array', required: true,
        description: 'The 3-5 concrete steps you intend to take, in order.',
        items: { type: 'string' },
      },
      needsConfirmation: {
        type: 'boolean', required: true,
        description: 'true when this task is multi-step or ambiguous and the user should confirm first.',
      },
      isRevision: {
        type: 'boolean',
        description: 'true when the user changed the requirement mid-task and this restates the updated plan.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        required: ['status', 'confirmed', 'unconfirmed', 'declined', 'restatement', 'steps'],
        properties: {
          status: { type: 'string' },
          confirmed: { type: 'boolean' },
          unconfirmed: { type: 'boolean' },
          declined: { type: 'boolean' },
          restatement: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const marker = `[task-align:${value.status}]`
        if (value.status === 'awaiting') {
          return [{
            type: 'text',
            text: `${marker} The plan is recorded and the gate is closed until the user answers. Do not retry any`
              + ' tool. Show the restatement and steps below to the user in your message, then end your turn.'
              + ' Their confirmation starts your next turn.\n'
              + `Restatement: ${value.restatement}\nSteps: ${value.steps.join(' | ')}`,
          }]
        }
        const plan = `Restatement: ${value.restatement}\nSteps: ${value.steps.join(' | ')}`
        if (value.declined) {
          return [{
            type: 'text',
            text: `${marker} The user rejected this understanding. Do not start work: ask what to change instead.`,
          }]
        }
        if (value.unconfirmed) {
          return [{
            type: 'text',
            text: `${marker} The user did not answer in time, so the gate opened UNCONFIRMED. Say so plainly in your `
              + 'next message, follow the plan of record below, and stay ready to change course.\n' + plan,
          }]
        }
        return [{
          type: 'text',
          text: `${marker} The gate is open; the version below is authoritative — follow it, not your draft.\n` + plan,
        }]
      },
    },
    async execute(args, exec) {
      try {
        return await runGate(args, exec)
      } catch (error) {
        // A broken gate must never hold the session hostage.
        if (exec.agent) gates.set(exec.agent, { state: 'open' })
        throw error
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Confirm the understood task',
      kind: 'other',
      rawInput: { restatement: args.restatement, steps: args.steps },
    }),
  })

  // The confirmation channel: a human command the composer and the client card
  // both reach, so a click works even when nothing answers questions in the UI.
  ctx.commands.register({
    name: 'task-align',
    description: '确认或订正当前任务的理解与计划（confirm / edit <订正> / decline）',
    input: { hint: 'confirm | edit <订正后的要求> | decline' },
    handler: ({ agent, rawInput }) => {
      const text = String(rawInput ?? '').trim()
      const pending = waiters.get(agent)
      const durable = pending === undefined ? durablePlan(agent) : undefined
      const plan = pending?.record ?? (durable !== undefined && durable.steps.length > 0
        ? { restatement: durable.restatement, steps: durable.steps }
        : undefined)

      // `done` never depends on a pending request: it is the escape hatch.
      if (/^(done|finish|完成|结束|收工)$/i.test(text)) {
        waiters.delete(agent)
        approved.delete(agent)
        gates.set(agent, { state: 'open' })
        return { kind: 'success', text: '已结束本次任务并打开闸门，下一次动手前会重新对齐。' }
      }

      if (plan === undefined) {
        return { kind: 'error', text: '当前没有等待确认的任务。可用 /task-align done 强制结束并开闸。' }
      }

      const resume = (note) => {
        // Wake the agent so it continues on its own. A hand-built user message is
        // enough: createUserMessage only adds an id and the role tag.
        try {
          agent.followup({
            id: `task-align-${Date.now().toString(36)}`,
            role: 'user',
            content: [{ type: 'text', text: note }],
            source: { kind: 'user' },
          })
        } catch (error) {
          ctx.logger?.warn?.('[task-align] could not wake the agent after confirmation', error)
        }
      }

      waiters.delete(agent)
      if (/^(decline|cancel|no|n|取消|不|停)$/i.test(text)) {
        approved.delete(agent)
        gates.set(agent, { state: 'closed' })
        resume('[task-align:declined] 用户拒绝了这份计划，不要开工。请先问清楚要改哪里，再重新对齐。')
        return { kind: 'success', text: '已取消本轮，不会开工。' }
      }
      const edit = text.match(/^edit\s+([\s\S]+)$/i)
      if (edit !== null) {
        const edited = edit[1].trim()
        const lines = edited.split('\n').map(line => line.trim()).filter(Boolean)
        const steps = lines.length > 1
          ? lines.slice(1).map(step => ({ text: step }))
          : plan.steps.map(step => ({ text: step.text }))
        approved.set(agent, { restatement: lines[0] ?? plan.restatement, steps })
        gates.set(agent, { state: 'open' })
        resume(`[task-align] 用户已按这版订正并确认，请按它继续：${lines[0] ?? plan.restatement}`)
        return { kind: 'success', text: '已按你的订正版本开工。' }
      }
      if (text === '' || /^(confirm|ok|yes|y|确认|确认开工|开始|好)$/i.test(text)) {
        approved.set(agent, { restatement: plan.restatement, steps: plan.steps })
        gates.set(agent, { state: 'open' })
        resume(`[task-align] 用户已确认该计划，请继续执行：${plan.restatement}`)
        return { kind: 'success', text: '已确认，按计划开工。' }
      }
      return { kind: 'error', text: '用法：/task-align confirm、/task-align edit <订正后的要求>、/task-align decline' }
    },
  })

  // A denial that must hold regardless of listener order is a guard, and a guard
  // is synchronous — so gate state lives in memory and never awaits.
  ctx.effect(() => ctx.tools.guard(exec => {
    if (exec.name === CONFIRM_TOOL) return undefined
    if (EXECUTOR_TOOLS.has(exec.name)) return undefined
    if (!exec.agent) return undefined
    const gate = gates.get(exec.agent)
    if (gate === undefined || gate.state === 'open') return undefined
    // Fail open after a few denials: if the confirmation tool is broken or the
    // card never arrives, the session must not be locked out of every tool.
    const count = (denials.get(exec.agent) ?? 0) + 1
    denials.set(exec.agent, count)
    if (count > 3) {
      gates.set(exec.agent, { state: 'open' })
      ctx.logger?.warn?.(`[task-align] gate opened after ${count} denials; the confirmation path may be broken`)
      return undefined
    }
    return `"${exec.name}" is blocked until the task is confirmed: call ${CONFIRM_TOOL} with your `
      + 'restatement of the task and a 3-5 step plan first, then wait for its result. '
      + `(${count}/3 before the gate opens by itself.)`
  }), 'task-align:guard')

  // A human message arms a fresh gate; automated input (goal rounds, schedules,
  // subagent relays) never does, so unattended work keeps running unattended.
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    // Our own wake-up message is a user-role message too, but it confirms the
    // plan rather than adding a requirement: it must not re-arm the gate.
    const human = messages.find(message => message?.source?.kind === 'user'
      && !messageText(message).startsWith('[task-align'))
    if (human !== undefined) {
      // Close the gate for this turn but keep the approved plan: a plain
      // follow-up continues the same task and must not re-ask. A genuine
      // requirement change is declared by the model through isRevision, which
      // forces a new card regardless of the existing approval.
      plans.delete(agent)
      denials.delete(agent)
      gates.set(agent, { state: 'closed' })
    }
    return next()
  })

  // An idle agent disarms the gate; only the next human message re-arms it.
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') gates.set(agent, { state: 'open' })
  })
}
