/**
 * dsh-task-align — bundled skill provider (the "task enhancer").
 *
 * Registers one model-invocable skill whose body lives in `assets/`, so the
 * model can load the restatement-and-plan rubric exactly when a task is
 * multi-step. It is a separate Loader row from the gate: if this provider fails
 * to register, the gate still works, and the other way round.
 *
 * The package is a linked workspace directory, so it imports nothing from DSH.
 * `BUNDLED_SKILL_RANK` is copied from `@deepseek-ai/dsh-skill` (value 600) for
 * the same reason: a linked directory cannot resolve that package.
 *
 * @module dsh-task-align/skills
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const BUNDLED_SKILL_RANK = 600
const PROVIDER_NAME = 'task-align'
const SKILL_NAME = 'task-align-plan'
const SKILL_BODY_URL = new URL('./assets/task-align-enhancer.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('./assets/', import.meta.url)),
}
const INVOCATION = { modelInvocable: true, userInvocable: true }
const DESCRIPTION = '把请求复述成可验收的目标与约束，并给出 3–5 步可验收的执行计划。'
  + ' Restate a request as a verifiable goal plus constraints, then plan 3-5 verifiable steps.'
  + ' Use before starting any multi-step task, when the request carries several requirements,'
  + ' or when the task looks ambiguous.'

const CANDIDATE = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get() {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'task-align-skills'

/** The skill registry is the only service this row needs. */
export const inject = ['skills']

/**
 * Register the bundled enhancer provider.
 * @param ctx - registrant context carrying the skill registry.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.skills.registerProvider(() => provider), 'task-align:skill-provider')
}
