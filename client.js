/* dsh-task-align — Web client half.
 *
 * Two seats next to the composer:
 *   conversation.input.dock  — the gate card, shown only while a
 *                              `confirm_task_understanding` call still awaits
 *                              an answer.
 *   conversation.input.right — a compact progress control beside the submit
 *                              action (the `activity` seat is single and
 *                              already holds voice input).
 *
 * Geometry is copied from the shipped GoalBar so the card lines up with the
 * goal bar and the composer card instead of looking like a foreign block.
 * Reads come from the Chat snapshot's tool lifecycle; the only write is the
 * `/task-align` human command, which is what releases the Host gate.
 *
 * Components must be declared inside `apply` so they can close over `ctx`.
 * Loaded as a classic script: no JSX, no CSS module, no Remote of its own.
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-align',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TOOL = 'confirm_task_understanding'
    const NS = 'taskAlign'

    const zh = {
      'card.title': '开工前确认',
      'card.waiting': '等待你的确认',
      'card.understood': '我理解你要的是',
      'card.plan': '打算这样做',
      'card.confirm': '确认开工',
      'card.edit': '改一下',
      'card.decline': '不对，先别做',
      'card.editHint': '写下订正后的要求，我按你写的执行',
      'card.sendEdit': '按这个执行',
      'card.cancelEdit': '取消',
      'mini.gate': '等待确认',
      'mini.step': '第 {step} 步',
      'mini.done': '第 {step} 步已完成',
      'summary.name': '任务对齐',
      'summary.reported': '已上报',
      'summary.close': '关闭',
      'summary.running': '进行中',
      'summary.finished': '本轮已结束',
      'summary.noReport': '未上报进度',
      'summary.supplement': '补充需求',
      'summary.finish': '结束任务',
      'card.revisionTitle': '计划更新',
      'card.revisionHint': '你改了需求，重新对齐',
    }
    const en = {
      'card.title': 'Confirm before starting',
      'card.waiting': 'Waiting for your confirmation',
      'card.understood': 'I read your request as',
      'card.plan': 'Plan',
      'card.confirm': 'Start',
      'card.edit': 'Edit',
      'card.decline': 'Wrong, do not start',
      'card.editHint': 'Write the corrected request; I follow your version',
      'card.sendEdit': 'Use this',
      'card.cancelEdit': 'Cancel',
      'mini.gate': 'Waiting',
      'mini.step': 'Step {step}',
      'mini.done': 'Step {step} done',
      'summary.name': 'Task alignment',
      'summary.reported': 'reported',
      'summary.close': 'Dismiss',
      'summary.running': 'running',
      'summary.finished': 'turn finished',
      'summary.noReport': 'no progress reported',
      'summary.supplement': 'Add a requirement',
      'summary.finish': 'Finish task',
      'card.revisionTitle': 'Plan updated',
      'card.revisionHint': 'You changed the requirement',
    }

    /* Same column width as the goal bar and the queue panel: the composer card
       minus its side clearance and four dock insets. */
    const CSS = `
.ta-dock {
  box-sizing: border-box;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance)
                 - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset)
                 - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));
  margin: 0 auto 6px;
}
/* Okabe-Ito colour-blind-safe palette: #0072B2 for the action and the marks,
   #56B4E9 only as a hover tint; surfaces and text stay on host tokens so both
   themes hold. */
.ta-card {
  --ta-ink: #0072B2;
  --ta-accent: #0072B2;
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  width: 100%;
  max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));
  margin: 0 auto;
  padding: 9px 12px 10px 13px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-left: 3px solid var(--ta-accent);
  border-radius: 4px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.ta-card::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: 3px;
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  content: '';
  pointer-events: none;
}
.ta-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.ta-dot {
  flex: none; width: 5px; height: 5px; border-radius: 50%;
  background: var(--ta-accent); align-self: center;
}
.ta-title {
  flex: none; font-size: 12px; line-height: 22px; font-weight: 600;
  letter-spacing: 0.06em; color: var(--dsw-alias-label-primary);
}
.ta-meta {
  min-width: 0; overflow: hidden; font-size: 12px; line-height: 20px;
  color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap;
}
.ta-goal {
  margin: 2px 0 8px; font-size: 13px; line-height: 21px;
  color: var(--dsw-alias-label-primary); white-space: pre-wrap; word-break: break-word;
}
.ta-caption {
  margin: 0 0 3px; font-size: 11px; line-height: 16px; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--dsw-alias-label-tertiary);
}
.ta-steps { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.ta-step { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.ta-idx {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; margin-top: 2px; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--ta-accent) 45%, transparent);
  color: var(--ta-accent);
  font-size: 10px; line-height: 1; font-variant-numeric: tabular-nums;
}
.ta-text { min-width: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.ta-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.ta-btn {
  appearance: none; height: 27px; padding: 0 11px; border-radius: 3px;
  border: 1px solid transparent; background: transparent; cursor: pointer;
  font: inherit; font-size: 12px; line-height: 25px; letter-spacing: 0.01em;
}
.ta-btn:disabled { opacity: 0.45; cursor: default; }
.ta-btn:focus-visible { outline: 1px solid var(--ta-accent); outline-offset: 2px; }
.ta-primary { background: var(--ta-ink); color: #ffffff; border-color: var(--ta-ink); }
.ta-secondary { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.ta-ghost { padding: 0 8px; color: var(--dsw-alias-label-tertiary); }
@media (hover: hover) {
  .ta-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ta-ink) 84%, #56B4E9); }
  .ta-secondary:hover:not(:disabled) { border-color: var(--ta-accent); color: var(--ta-accent); }
  .ta-ghost:hover:not(:disabled) { color: var(--dsw-alias-label-secondary); text-decoration: underline; }
}
.ta-input {
  box-sizing: border-box; width: 100%; min-height: 54px; margin-top: 7px; padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px; resize: vertical;
}
.ta-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.ta-input:focus-visible { outline: 1px solid var(--ta-accent); outline-offset: -1px; }
.ta-error {
  display: flex; align-items: center; gap: 5px; margin-top: 7px;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary);
}
.ta-mini {
  display: inline-flex; align-items: center; gap: 6px; padding: 0 2px;
  font-size: 12px; line-height: 24px; font-weight: 500; letter-spacing: 0.02em;
  white-space: nowrap; color: var(--dsw-alias-label-tertiary);
}
.ta-mini-dot {
  flex: none; width: 5px; height: 5px; border-radius: 50%;
  background: #0072B2;
}
.ta-mini-dot-idle {
  flex: none; width: 5px; height: 5px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary); opacity: 0.5;
}
.ta-card--summary {
  padding: 4px 10px;
  border-left-color: var(--dsw-alias-border-l2);
}
.ta-summary {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
  padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
  font: inherit; font-size: 12px; line-height: 22px; color: var(--dsw-alias-label-tertiary);
}
.ta-summary:hover { color: var(--dsw-alias-label-secondary); }
.ta-summary:focus-visible { outline: 1px solid var(--ta-accent); outline-offset: 2px; border-radius: 3px; }
.ta-summary-dot { flex: none; width: 5px; height: 5px; border-radius: 50%; }
.ta-summary-name { flex: none; font-weight: 600; letter-spacing: 0.02em; }
.ta-summary-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ta-caret { flex: none; opacity: 0.6; font-size: 10px; line-height: 1; }
.ta-summary-act {
  flex: none; height: 20px; padding: 0 7px; margin-left: 2px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 3px;
  background: transparent; cursor: pointer; font: inherit; font-size: 11px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.ta-summary-act:hover { border-color: var(--ta-accent); color: var(--ta-accent); }
.ta-summary-act:focus-visible { outline: 1px solid var(--ta-accent); outline-offset: 1px; }
.ta-close {
  flex: none; margin-left: auto; width: 18px; height: 18px; padding: 0;
  border: 0; border-radius: 3px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1;
}
.ta-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.ta-close:focus-visible { outline: 1px solid var(--ta-accent); outline-offset: 1px; }
.ta-detail { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); }
.ta-detail .ta-steps { margin-top: 6px; }
.ta-detail .ta-step .ta-text { font-size: 12px; line-height: 18px; }
.ta-step--done .ta-idx {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.ta-step--doing .ta-idx {
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-gray-0, #ffffff);
}
.ta-step--doing .ta-text { color: var(--dsw-alias-label-primary); }
.ta-step--todo .ta-idx {
  border-color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 45%, transparent);
  color: var(--dsw-alias-label-tertiary);
}
.ta-step--todo .ta-text { color: var(--dsw-alias-label-tertiary); }

`

    /** Summaries the user closed in this page session; a reload clears them. */
    const dismissed = new Set()

    /** Build a translating lookup that always answers. */
    function translator(t) {
      if (typeof t !== 'function') return (key, fallback) => fallback ?? key
      return (key, fallback) => {
        try {
          const value = t(key)
          return typeof value === 'string' && value.length > 0 ? value : (fallback ?? key)
        } catch {
          return fallback ?? key
        }
      }
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const element = document.createElement('style')
          element.dataset.plugin = 'dsh-task-align'
          element.textContent = CSS
          document.head.append(element)
          return () => element.remove()
        }, 'task-align:styles')

        try {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'task-align:dictionaries')
        } catch (error) {
          console.warn('[task-align] locale registration failed', error)
        }

        /** Send one `/task-align` line and normalize the Remote result. */
        async function runCommand(sessionId, line) {
          const commands = ctx.remote && ctx.remote.commands
          if (!commands || typeof commands.execute !== 'function') throw new Error('命令通道不可用')
          const response = await commands.execute(sessionId, line, [])
          if (response === undefined || response === null) throw new Error('没有响应')
          if (response.ok !== true) {
            throw new Error((response.error && (response.error.message || response.error.code)) || '调用失败')
          }
          if (response.value === undefined) throw new Error('命令未识别')
          const outcome = response.value.result
          if (outcome && outcome.kind === 'error') throw new Error(outcome.text || '命令失败')
          return outcome
        }

        function button(style, disabled, onClick, label) {
          return h('button', { type: 'button', className: 'ta-btn ' + style, disabled, onClick }, label)
        }

        const STATUS_LABEL = {
          confirmed: '已确认',
          approved: '按已批准计划继续',
          declined: '已拒绝',
          aborted: '已取消',
        }
        const STATUS_COLOR = {
          confirmed: 'var(--dsw-alias-state-success-primary)',
          approved: 'var(--dsw-alias-state-success-primary)',
          declined: 'var(--dsw-alias-label-tertiary)',
          aborted: 'var(--dsw-alias-label-tertiary)',
        }

        /** The gate card above the composer, plus its settled one-line summary. */
        /**
         * Read this session's plan state from the host projection.
         * @param useProjection - the slot's projection hook.
         * @returns the state, or null before a task and when the projection is absent.
         */
        function readPlan(useProjection) {
          if (typeof useProjection !== 'function') return null
          let state = null
          try {
            state = useProjection('taskAlignPlan')
          } catch {
            state = null
          }
          if (state === null || state === undefined || state.status === 'idle') return null
          return state
        }

        /**
         * Shape the projection state for rendering.
         * @param plan - the projection state, or null.
         * @returns null, or a view with per-step states and totals.
         */
        function buildSummary(plan) {
          if (plan === null) return null
          const steps = Array.isArray(plan.steps) ? plan.steps : []
          const stepStates = steps.map(step => {
            const status = String(step && step.status ? step.status : 'todo')
            return {
              text: String(step && step.text ? step.text : ''),
              status: status === 'done' || status === 'skipped' ? 'done' : (status === 'doing' ? 'doing' : 'todo'),
            }
          })
          const doingIndex = stepStates.findIndex(step => step.status === 'doing')
          return {
            status: String(plan.status ?? ''),
            restatement: String(plan.restatement ?? ''),
            steps: stepStates.map(step => step.text),
            stepStates,
            stepCount: stepStates.length,
            reported: stepStates.filter(step => step.status === 'done').length,
            currentStep: doingIndex < 0 ? null : doingIndex + 1,
            revision: plan.revision === true,
            callId: String(plan.callId ?? ''),
          }
        }

        function AlignCard(props) {
          const tr = translator(props.t)
          const sessionId = props.sessionId
          // Everything below comes from the host projection: the gate call records
          // the plan, the `/task-align` command records the answer. No inference.
          const summary = buildSummary(readPlan(props.useProjection))
          const [editing, setEditing] = React.useState(false)
          const [draft, setDraft] = React.useState('')
          const [busy, setBusy] = React.useState(false)
          const [failure, setFailure] = React.useState(null)
          const [open, setOpen] = React.useState(false)
          // Boolean when the snapshot exposes it, undefined when it does not —
          // the state word is simply omitted rather than guessed.
          const sessionRunning = typeof props.useSession === 'function'
            ? props.useSession(snapshot => {
                if (!snapshot) return undefined
                if (typeof snapshot.running === 'boolean') return snapshot.running
                if (typeof snapshot.status === 'string') return snapshot.status === 'running'
                return undefined
              })
            : undefined
          const [, bumpClosed] = React.useReducer(count => count + 1, 0)

          const callId = summary === null ? '' : summary.callId
          React.useEffect(() => {
            setEditing(false)
            setDraft('')
            setFailure(null)
            setBusy(false)
          }, [callId])

          if (summary === null) return null
          {
            // The host records "awaiting" when the gate tool is called; nothing
            // else can produce it, so the card is a direct read, not a guess.
            if (summary.status === 'awaiting') {
              const gateSteps = Array.isArray(summary.steps) ? summary.steps.filter(Boolean) : []
              return renderCard({
                restatement: summary.restatement,
                steps: gateSteps,
                isRevision: summary.revision === true,
              })
            }
            // Only an approved gate leaves a receipt worth keeping. A timeout,
            // refusal or cancellation is already stated in the assistant reply;
            // parking it above the composer would just be stale noise.
            if (summary.status !== 'confirmed' && summary.status !== 'edited'
              && summary.status !== 'approved') return null
            if (summary.callId !== '' && dismissed.has(summary.callId)) return null
            const label = STATUS_LABEL[summary.status] ?? summary.status
            const parts = [tr('summary.name', '任务对齐'), label]
            const running = summary.currentStep !== null && summary.currentStep !== undefined
              && sessionRunning !== false
            if (running) parts.push(`第 ${summary.currentStep} 步进行中`)
            if (summary.stepCount > 0) {
              // The total is always visible: at the start "step 1 of 4" is the
              // only promise the user has, and hiding it until the first report
              // reads as if the plugin knows nothing about the plan.
              if (summary.reported > 0) parts.push(`${summary.reported}/${summary.stepCount} 步已完成`)
              else if (running) parts.push(`共 ${summary.stepCount} 步`)
              else parts.push(`${tr('summary.noReport', '未上报进度')} · 共 ${summary.stepCount} 步`)
            }
            if (sessionRunning === false) parts.push(tr('summary.finished', '本轮已结束'))
            else if (sessionRunning === true) parts.push(tr('summary.running', '进行中'))
            return h('div', { className: 'ta-dock' },
              h('section', { className: 'ta-card ta-card--summary', 'data-task-align': 'summary' },
                h('button', {
                  type: 'button', className: 'ta-summary',
                  'aria-expanded': open,
                  onClick: () => setOpen(!open),
                },
                  h('span', { className: 'ta-summary-dot', 'aria-hidden': 'true', style: { background: STATUS_COLOR[summary.status] ?? 'var(--dsw-alias-label-tertiary)' } }),
                  h('span', { className: 'ta-summary-name' }, tr('summary.name', '任务对齐')),
                  h('span', { className: 'ta-summary-meta' }, parts.slice(1).join(' · ')),
                  h('span', { className: 'ta-caret', 'aria-hidden': 'true' }, open ? '\u25be' : '\u25b8'),
                  h('button', {
                    type: 'button', className: 'ta-summary-act',
                    title: tr('summary.supplement', '补充需求'),
                    onClick: event => {
                      event.stopPropagation()
                      const actions = props.inputActions
                      const text = tr('summary.supplement', '补充需求') + '：'
                      try {
                        if (actions && typeof actions.captureInsertion === 'function'
                          && typeof actions.insertText === 'function') {
                          actions.insertText(text, actions.captureInsertion())
                          return
                        }
                        if (actions && typeof actions.setDraft === 'function') actions.setDraft(text)
                      } catch (error) {
                        console.warn('[task-align] could not prefill the composer', error)
                      }
                    },
                  }, tr('summary.supplement', '补充需求')),
                  h('button', {
                    type: 'button', className: 'ta-summary-act',
                    title: tr('summary.finish', '结束任务'),
                    onClick: event => {
                      event.stopPropagation()
                      dismissed.add(summary.callId)
                      bumpClosed()
                      runCommand(sessionId, '/task-align done')
                        .catch(error => console.warn('[task-align] finish failed', error))
                    },
                  }, tr('summary.finish', '结束任务')),
                  h('button', {
                    type: 'button', className: 'ta-close', 'aria-label': tr('summary.close', '关闭'),
                    title: tr('summary.close', '关闭'),
                    onClick: event => { event.stopPropagation(); dismissed.add(summary.callId); bumpClosed() },
                  }, '\u00d7'),
                ),
                open
                  ? h('div', { className: 'ta-detail' },
                      h('p', { className: 'ta-caption' }, tr('card.understood', '我理解你要的是')),
                      h('div', { className: 'ta-goal' }, summary.restatement),
                      summary.stepStates.length === 0
                        ? (summary.stepCount === 0 ? null : h('p', { className: 'ta-caption' },
                            tr('summary.noReport', '未上报进度')))
                        : h('ol', { className: 'ta-steps' }, summary.stepStates.map((entry, index) =>
                            h('li', { className: 'ta-step ta-step--' + entry.status, key: String(index) },
                              h('span', { className: 'ta-idx', 'aria-hidden': 'true' }, String(index + 1)),
                              h('span', { className: 'ta-text' }, entry.text),
                            ))),
                    )
                  : null,
              ),
            )
          }

          function renderCard(gate) {
          const steps = gate.steps
          const send = line => {
            setBusy(true)
            setFailure(null)
            runCommand(sessionId, line)
              .catch(error => setFailure(String((error && error.message) || error)))
              .then(() => setBusy(false))
          }

          return h('div', { className: 'ta-dock' },
            h('section', { className: 'ta-card', 'data-task-align': 'card', role: 'group', 'aria-label': tr('card.title', '开工前确认') },
              h('div', { className: 'ta-head' },
                h('span', { className: 'ta-dot', 'aria-hidden': 'true' }),
                h('span', { className: 'ta-title' }, gate.isRevision === true
                  ? tr('card.revisionTitle', '计划更新')
                  : tr('card.title', '开工前确认')),
                h('span', { className: 'ta-meta' }, '· ' + (gate.isRevision === true
                  ? tr('card.revisionHint', '你改了需求，重新对齐')
                  : tr('card.waiting', '等待你的确认'))),
              ),
              h('p', { className: 'ta-caption' }, tr('card.understood', '我理解你要的是')),
              h('div', { className: 'ta-goal' }, String(gate.restatement ?? '')),
              steps.length === 0 ? null : h('div', null,
                h('p', { className: 'ta-caption' }, tr('card.plan', '打算这样做')),
                h('ol', { className: 'ta-steps' },
                  steps.map((step, index) => h('li', { key: index, className: 'ta-step' },
                    h('span', { className: 'ta-idx', 'aria-hidden': 'true' }, String(index + 1)),
                    h('span', { className: 'ta-text' }, step),
                  )),
                ),
              ),
              editing
                ? h('div', null,
                    h('textarea', {
                      className: 'ta-input',
                      value: draft,
                      placeholder: tr('card.editHint', '写下订正后的要求，我按你写的执行'),
                      autoFocus: true,
                      disabled: busy,
                      onChange: event => setDraft(event.target.value),
                    }),
                    h('div', { className: 'ta-actions' },
                      button('ta-primary', busy || draft.trim().length === 0, () => send('/task-align edit ' + draft.trim()), tr('card.sendEdit', '按这个执行')),
                      button('ta-secondary', busy, () => { setEditing(false); setDraft('') }, tr('card.cancelEdit', '取消')),
                    ),
                  )
                : h('div', { className: 'ta-actions' },
                    button('ta-primary', busy, () => send('/task-align confirm'), tr('card.confirm', '确认开工')),
                    button('ta-secondary', busy, () => setEditing(true), tr('card.edit', '改一下')),
                    button('ta-ghost', busy, () => send('/task-align decline'), tr('card.decline', '不对，先别做')),
                  ),
              failure === null ? null : h('div', { className: 'ta-error', role: 'alert' },
                h('span', { 'aria-hidden': 'true' }, '\u26a0'),
                h('span', null, failure),
              ),
            ),
          )
          }

          return null
        }

        /** The compact control beside the submit action. */
        function AlignMini(props) {
          const tr = translator(props.t)
          const summary = buildSummary(readPlan(props.useProjection))
          if (summary !== null && summary.status === 'awaiting') {
            return h('span', { className: 'ta-mini', role: 'status' },
              h('span', { className: 'ta-mini-dot', 'aria-hidden': 'true' }),
              tr('mini.gate', '等待确认'),
            )
          }

          if (summary === null || summary.currentStep === null) return null
          const finished = summary.stepStates[summary.currentStep - 1].status === 'done'
          const text = (finished ? tr('mini.done', '第 {step} 步已完成') : tr('mini.step', '第 {step} 步'))
            .replace('{step}', String(summary.currentStep))
          return h('span', { className: 'ta-mini', role: 'status', title: text },
            h('span', { className: 'ta-mini-dot-idle', 'aria-hidden': 'true' }), text)
        }

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'task-align', order: 20, locale: NS,
        }, AlignCard))
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'task-align-progress', order: 20, locale: NS,
        }, AlignMini))
      },
    }
  },
})
