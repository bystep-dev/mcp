import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { api, ApiError } from './api.js'
import { apiUrl, defaultPlanId, defaultWorkspaceId, VERSION } from './config.js'
import { gitHead, runAcceptance, verifyRepoRoot, writePendingTask } from './verify.js'

const planIdSchema = z.string().optional().describe('Plan id. Defaults to BYSTEP_PLAN_ID or .bystep/config.json planId.')
const refSchema = z.string().describe('Task ref as returned by task_next (e.g. "auth-login-form").')

const resolvePlan = (planId) => {
  const id = planId || defaultPlanId()
  if (!id) throw new ApiError(400, 'planId required (pass it, set BYSTEP_PLAN_ID, or run `npx @bystep/cli connect --plan <id>`)', 'bad_request')
  return id
}
const okText = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const errText = (e) => ({ isError: true, content: [{ type: 'text', text: e instanceof ApiError ? `${e.status} ${e.message}${e.code ? ` (${e.code})` : ''}` : String(e?.message ?? e) }] })
const wrap = (fn) => async (args) => {
  try {
    return okText(await fn(args ?? {}))
  } catch (e) {
    return errText(e)
  }
}

// ---------------------------------------------------------------- rendering helpers
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const list = (arr, empty = '(none)') => (arr?.length ? arr.map((x) => `- ${x}`).join('\n') : empty)

function renderPacket(p) {
  const lines = [
    `# ${p.title}`,
    `\`${p.ref}\``,
    '',
    `**Tier:** ${p.tier}${p.escalated ? ' (escalated after repeated failures)' : ''} · **Layer:** ${p.layer} · **Priority:** ${p.priority}${p.modelHint ? ` · **Model hint:** ${p.modelHint}` : ''}`,
    '',
    `## Feature: ${p.feature.name} (phase ${p.feature.phase})`,
    p.feature.goal || '(no goal recorded)',
    '',
    '**Done when:**',
    list(p.feature.done),
    '',
    '## PRD excerpt',
    p.prdExcerpt || '(none)',
    '',
    '## Acceptance criteria',
    '| id | kind | cmd | expect | text |',
    '|---|---|---|---|---|',
    ...p.acceptance.map((a) => `| ${cell(a.id)} | ${cell(a.kind)} | ${cell(a.cmd)} | ${cell(a.expect)} | ${cell(a.text)} |`),
    '',
    '## Owned files (yours to change)',
    list(p.ownedFiles),
    '',
    '## Do NOT touch (owned by other in-flight tasks this phase)',
    list(p.doNotTouch),
    '',
    '## Relevant files',
    list(p.relevantFiles.map((f) => `\`${f.path}\` — ${f.summary}`)),
    '',
    '## Conventions',
    p.conventions || '(none)',
    '',
    '## Verify commands',
    list(p.verifyCommands.map((c) => `\`${c}\``)),
    '',
    `## Execution mode: ${p.execution.mode} (verifier: ${p.execution.verifier})`,
  ]
  return lines.join('\n')
}

const mark = (r) => (r.skipped ? '○' : r.ok ? '✔' : '✘') // ○ ✔ ✘

function renderVerify(acceptance, results, res) {
  const byId = new Map(results.map((r) => [r.id, r]))
  const lines = [`Verify — ${res.task.ref}`, '']
  for (const a of acceptance) {
    const r = byId.get(a.id)
    if (!r) continue
    lines.push(`${mark(r)} ${a.id} [${a.kind}] ${a.text}`)
    if (r.output) lines.push(`    ${r.output.split('\n').slice(0, 6).join('\n    ')}`)
  }
  lines.push('')
  lines.push(`Verdict: ${res.evidence.status.toUpperCase()} (${res.evidence.passed}/${res.evidence.total}) · attempt ${res.evidence.attempt} · task.verification=${res.task.verification}`)
  if (res.evidence.needsHuman?.length) lines.push(`Needs a human: ${res.evidence.needsHuman.join(', ')}`)
  if (res.reviewer) lines.push(`Reviewer: ${res.reviewer.status}${res.reviewer.note ? ` — ${res.reviewer.note}` : ''}${res.reviewer.skipped ? ` (skipped: ${res.reviewer.skipped})` : ''}`)
  return lines.join('\n')
}

function renderEvidence(rows) {
  if (!rows.length) return 'No evidence recorded yet.'
  return rows
    .map((e, i) => {
      const passed = e.criteriaResults?.filter((c) => c.ok).length ?? 0
      const total = e.criteriaResults?.length ?? 0
      const bits = [`${i === 0 ? '#1 (latest)' : `#${i + 1}`} ${e.status.toUpperCase()}`, `attempt ${e.attempt}`, `${passed}/${total}`, `verifier: ${e.verifier}`]
      if (e.commitHash) bits.push(`commit ${e.commitHash.slice(0, 8)}`)
      if (e.diffStat) bits.push(`+${e.diffStat.add}/-${e.diffStat.del} (${e.diffStat.files} files)`)
      const extra = []
      if (e.overrideReason) extra.push(`override reason: ${e.overrideReason}`)
      if (e.reviewerNote) extra.push(`reviewer note: ${e.reviewerNote}`)
      extra.push(new Date(e.createdAt).toISOString())
      return `${bits.join(' · ')}\n    ${extra.join(' · ')}`
    })
    .join('\n')
}

function renderWave(res, includePacket) {
  if (res.checkpoint_pending) {
    const c = res.checkpoint
    return `**STOP — checkpoint pending${c ? ` (phase ${c.phase}, layer ${c.layer}${c.taskRef ? `, task ${c.taskRef}` : ''})` : ''}. Report to the user; call phase_approve to continue.**`
  }
  if (res.done || !res.wave) return 'All tasks are done — no more waves.'
  const w = res.wave
  const lines = [
    w.leaderPrompt,
    '',
    `## Wave ${w.index} — phase ${w.phase} · ${w.layer}${w.sequentialOnly ? ' · SEQUENTIAL ONLY' : ' · parallel-safe'}`,
    '',
    '| ref | title | tier | model hint | owned files |',
    '|---|---|---|---|---|',
    ...w.tasks.map((p) => `| ${cell(p.ref)} | ${cell(p.title)} | ${cell(p.tier)} | ${cell(p.modelHint ?? '—')} | ${cell(p.ownedFiles.join(', '))} |`),
  ]
  if (includePacket !== false) {
    for (const p of w.tasks) {
      lines.push('', '---', renderPacket(p))
    }
  }
  return lines.join('\n')
}

export function createServer() {
  const server = new McpServer(
    { name: 'bystep', version: VERSION },
    {
      instructions:
        'Bystep hands you ONE task at a time. Loop: task_next → task_start → task_packet (fresh, small context for that one task — read it instead of the full PRD) → do only that task → task_verify (mandatory: runs the acceptance criteria and uploads evidence) → task_complete (rejected with 409 evidence_required until verification passes, unless you pass an explicit, recorded override reason). ' +
        'Three execution modes (in `execution.mode`, also on task_next): autopilot never stops the loop except when task_next reports done; checkpoint stops once per phase/layer group when checkpoint_pending is true, waiting for a human to call phase_approve; strict stops after EVERY task the same way. ' +
        'When task_next returns checkpoint_pending: true, STOP and report to the user — in autopilot mode this never happens except at done. ' +
        'Overrides (task_complete without passing evidence) are always recorded with their reason and stay visible in the evidence trail and on the web dashboard — never a silent bypass. ' +
        'For parallel work, call wave_next instead of task_next: it plans a batch of non-overlapping tasks for you to hand to parallel subagents/worktrees (Bystep never runs them itself), and every worker in the wave still follows the same task_start → task_verify → task_complete loop before you call wave_next again. Read the PRD with plan_get once at the start.',
    },
  )

  server.registerTool('plan_get', { title: 'Get plan (PRD)', description: 'Fetch the full PRD of a plan as text: goals, features, tech stack. Read it once before starting tasks.', inputSchema: { planId: planIdSchema, json: z.boolean().optional().describe('Return the raw JSON plan instead of text.') } }, wrap(async ({ planId, json }) => {
    const id = resolvePlan(planId)
    return json ? api(`/api/plan/${id}`) : api(`/api/plan/${id}?format=text`, { text: true })
  }))

  server.registerTool('plan_list', { title: 'List plans', description: 'List the plans of the logged-in user with their status and workspace.', inputSchema: {} }, wrap(async () => {
    try {
      return await api('/api/plan/list')
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) return api('/api/cli/plans')
      throw e
    }
  }))

  server.registerTool(
    'task_next',
    {
      title: 'Next task',
      description:
        'Ask the server for ONE next task of a plan. Returns { done, task:{ref,title,layer,tier,acceptance,packet,...}, execution, checkpoint_pending, checkpoint?, progress }. done:true means all tasks are finished. ' +
        'If checkpoint_pending is true, STOP and report to the user (execution mode checkpoint/strict) — do not call task_start. In autopilot mode never stop except when done.',
      inputSchema: { planId: planIdSchema, packet: z.boolean().optional().describe('Embed the task packet (task.packet) in the response. Default true; pass false to skip it (e.g. when you will call task_packet separately).') },
    },
    wrap(async ({ planId, packet }) => api(`/api/plan/tasks/next?planId=${encodeURIComponent(resolvePlan(planId))}${packet === false ? '&packet=0' : ''}`)),
  )

  server.registerTool(
    'task_packet',
    { title: 'Task packet', description: 'Fresh context for ONE task. Read this instead of the full PRD when working on the task. Returns the packet rendered as Markdown: title, tier, model hint, feature goal + done bullets, PRD excerpt, acceptance table, owned files, do-not-touch, relevant files, conventions, verify commands, execution mode.', inputSchema: { planId: planIdSchema, ref: refSchema } },
    wrap(async ({ planId, ref }) => {
      const { packet } = await api(`/api/plan/tasks/packet?planId=${encodeURIComponent(resolvePlan(planId))}&ref=${encodeURIComponent(ref)}`)
      return renderPacket(packet)
    }),
  )

  server.registerTool(
    'task_start',
    { title: 'Start task', description: 'Mark a task in_progress. Work ONLY on this task until it is done.', inputSchema: { planId: planIdSchema, ref: refSchema } },
    wrap(async ({ planId, ref }) => {
      const id = resolvePlan(planId)
      const body = { planId: id, ref, status: 'in_progress' }
      if (process.env.BYSTEP_AGENT) body.agent = process.env.BYSTEP_AGENT
      if (process.env.BYSTEP_MODEL) body.model = process.env.BYSTEP_MODEL
      const res = await api('/api/plan/tasks/by-ref', { method: 'PATCH', body })
      const root = verifyRepoRoot()
      writePendingTask(root, { ref, startedAt: new Date().toISOString(), headBefore: gitHead(root) })
      return res
    }),
  )

  server.registerTool(
    'task_verify',
    {
      title: 'Verify task',
      description: 'Run the task\'s acceptance criteria locally and upload pass/fail evidence. Call this before task_complete. Non-runnable kinds (screenshot, manual) are reported as skipped, not failures.',
      inputSchema: {
        planId: planIdSchema,
        ref: refSchema,
        skip: z.array(z.string()).optional().describe('Acceptance criterion ids to skip (reported as skipped, not run).'),
        override: z.string().min(3).max(500).optional().describe('Skip running criteria entirely and mark the task done with this reason recorded as an override.'),
        noScreenshot: z.boolean().optional().describe('No-op here: the MCP server has no browser, so screenshot criteria are always skipped with "screenshot needs the CLI". Kept for parity with `bystep task verify`.'),
        timeoutSeconds: z.number().int().positive().max(3600).optional().describe('Timeout for test/build/lint commands. Default 600.'),
      },
    },
    wrap(async ({ planId, ref, skip, override, timeoutSeconds }) => {
      const id = resolvePlan(planId)
      if (override) {
        const res = await api('/api/plan/tasks/by-ref', { method: 'PATCH', body: { planId: id, ref, status: 'done', override: { reason: override } } })
        return `Override recorded: ${ref} marked done without running criteria.\nReason: ${override}\nTask: ${JSON.stringify(res.task)}`
      }
      const { packet } = await api(`/api/plan/tasks/packet?planId=${encodeURIComponent(id)}&ref=${encodeURIComponent(ref)}`)
      const { results, commitHash, diffStat, filesTouched, durationMs } = await runAcceptance(packet.acceptance, { ref, skip: skip ?? [], timeoutSeconds })
      const body = {
        planId: id,
        ref,
        criteriaResults: results,
        ...(commitHash ? { commitHash } : {}),
        ...(diffStat ? { diffStat } : {}),
        ...(filesTouched ? { filesTouched } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(process.env.BYSTEP_AGENT ? { agent: process.env.BYSTEP_AGENT } : {}),
        ...(process.env.BYSTEP_MODEL ? { model: process.env.BYSTEP_MODEL } : {}),
      }
      const res = await api('/api/plan/tasks/evidence', { method: 'POST', body })
      return renderVerify(packet.acceptance, results, res)
    }),
  )

  server.registerTool(
    'task_complete',
    {
      title: 'Complete task',
      description: 'Requires passing evidence; call task_verify first. Marks the task done and returns the next step.',
      inputSchema: { planId: planIdSchema, ref: refSchema, override: z.string().min(3).max(500).optional().describe('Mark done without passing evidence. Recorded and visible in the evidence trail — use only when verification genuinely cannot run.') },
    },
    wrap(async ({ planId, ref, override }) => {
      const id = resolvePlan(planId)
      const body = { planId: id, ref, status: 'done', ...(override ? { override: { reason: override } } : {}) }
      let res
      try {
        res = await api('/api/plan/tasks/by-ref', { method: 'PATCH', body })
      } catch (e) {
        if (e instanceof ApiError && e.code === 'evidence_required') {
          throw new ApiError(409, `Task ${ref} has no passing evidence yet. Call task_verify first (it uploads pass/fail evidence), then retry task_complete — or pass an override reason if verification genuinely cannot run.`, 'evidence_required')
        }
        throw e
      }
      const next = await api(`/api/plan/tasks/next?planId=${encodeURIComponent(id)}`)
      return { task: res.task, next }
    }),
  )

  server.registerTool('task_fail', { title: 'Fail task', description: 'Mark a task failed with a short reason when blocked, then continue with task_next.', inputSchema: { planId: planIdSchema, ref: refSchema, reason: z.string().min(1).max(500).describe('Short reason why the task is blocked.') } }, wrap(async ({ planId, ref, reason }) => api('/api/plan/tasks/by-ref', { method: 'PATCH', body: { planId: resolvePlan(planId), ref, status: 'failed', reason } })))

  server.registerTool(
    'task_evidence_get',
    { title: 'Task evidence', description: 'Read the evidence trail of a task (newest first): status, attempt, passed/total, commit, diff, verifier, override reason, reviewer note, date.', inputSchema: { planId: planIdSchema, ref: refSchema } },
    wrap(async ({ planId, ref }) => {
      const { evidence } = await api(`/api/plan/tasks/evidence?planId=${encodeURIComponent(resolvePlan(planId))}&ref=${encodeURIComponent(ref)}`)
      return renderEvidence(evidence)
    }),
  )

  server.registerTool(
    'phase_approve',
    {
      title: 'Approve phase checkpoint',
      description: 'Record a human checkpoint approval for a phase (and layer), unblocking task_next in checkpoint/strict execution mode. Optionally return specific tasks to the agent with a reason.',
      inputSchema: {
        planId: planIdSchema,
        phase: z.number().int().min(1).max(20),
        layer: z.enum(['all', 'frontend', 'backend']).optional(),
        note: z.string().max(1000).optional(),
        returnTo: z.array(z.object({ ref: z.string().min(1), reason: z.string().min(1).max(500) })).max(50).optional().describe('Tasks to mark failed with a reason so the agent picks them up next, instead of a clean approval.'),
      },
    },
    wrap(async ({ planId, phase, layer, note, returnTo }) => api(`/api/plan/${encodeURIComponent(resolvePlan(planId))}/phase-approval`, { method: 'POST', body: { phase, layer, note, returnTo } })),
  )

  server.registerTool(
    'wave_next',
    {
      title: 'Next wave',
      description: 'Plan the next wave of non-overlapping tasks for parallel workers (subagents/worktrees). Bystep never runs them — you do. Each worker must still task_verify + task_complete. Call again when all workers finish.',
      inputSchema: { planId: planIdSchema, packet: z.boolean().optional().describe("Embed each task's full packet (Markdown) after the table. Default true.") },
    },
    wrap(async ({ planId, packet }) => {
      const res = await api(`/api/plan/tasks/wave?planId=${encodeURIComponent(resolvePlan(planId))}`)
      return renderWave(res, packet)
    }),
  )

  server.registerTool('sync_status', { title: 'Codebase sync status', description: 'Index/summary counts of the connected workspace: { status, fileCount, summarisedCount, hasWiki, wikiVersion }. Run `npx @bystep/cli sync --plan` / `npx @bystep/cli sync` from the CLI to update the index.', inputSchema: { workspaceId: z.string().optional().describe('Workspace id. Defaults to BYSTEP_WORKSPACE_ID or .bystep/config.json workspaceId.') } }, wrap(async ({ workspaceId }) => {
    const id = workspaceId || defaultWorkspaceId()
    if (!id) throw new ApiError(400, 'workspaceId required (pass it, set BYSTEP_WORKSPACE_ID, or run `npx @bystep/cli connect`)', 'bad_request')
    return api(`/api/workspaces/${encodeURIComponent(id)}/codebase-status`)
  }))

  return server
}

export async function main() {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(`bystep-mcp ${VERSION} · api ${apiUrl()} · stdio\n`)
}
