import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { api, ApiError } from './api.js'
import { apiUrl, defaultPlanId, defaultWorkspaceId } from './config.js'

const VERSION = '0.1.0'

const planIdSchema = z.string().optional().describe('Plan id. Defaults to BYSTEP_PLAN_ID or .bystep/config.json planId.')
const refSchema = z.string().describe('Task ref as returned by task_next (e.g. "auth-login-form").')

const resolvePlan = (planId) => {
  const id = planId || defaultPlanId()
  if (!id) throw new ApiError(400, 'planId required (pass it, set BYSTEP_PLAN_ID, or run `npx bystep connect --plan <id>`)', 'bad_request')
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

export function createServer() {
  const server = new McpServer({ name: 'bystep', version: VERSION }, { instructions: 'Bystep hands you ONE task at a time: call task_next, then task_start, do only that task, then task_complete (or task_fail with a reason). Stop and report to the user when task_next says done, or when the layer/phase of the next task differs from the one you just finished (checkpoint). Read the PRD with plan_get once at the start.' })

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

  server.registerTool('task_next', { title: 'Next task', description: 'Ask the server for ONE next task of a plan. Returns { done, task:{ref,title,layer,...}, progress:{ phase:{current,total}, layer, page, doneTasks, totalTasks } }. done:true means all tasks are finished. CHECKPOINT: if layer or phase.current differs from the task you just finished, stop and report to the user before task_start.', inputSchema: { planId: planIdSchema } }, wrap(async ({ planId }) => api(`/api/plan/tasks/next?planId=${encodeURIComponent(resolvePlan(planId))}`)))

  const setStatus = (status) => wrap(async ({ planId, ref, reason }) => api('/api/plan/tasks/by-ref', { method: 'PATCH', body: { planId: resolvePlan(planId), ref, status, reason } }))
  server.registerTool('task_start', { title: 'Start task', description: 'Mark a task in_progress. Work ONLY on this task until it is done.', inputSchema: { planId: planIdSchema, ref: refSchema } }, setStatus('in_progress'))
  server.registerTool('task_complete', { title: 'Complete task', description: 'Mark a task done, then call task_next again.', inputSchema: { planId: planIdSchema, ref: refSchema } }, setStatus('done'))
  server.registerTool('task_fail', { title: 'Fail task', description: 'Mark a task failed with a short reason when blocked, then continue with task_next.', inputSchema: { planId: planIdSchema, ref: refSchema, reason: z.string().min(1).max(500).describe('Short reason why the task is blocked.') } }, setStatus('failed'))

  server.registerTool('sync_status', { title: 'Codebase sync status', description: 'Index/summary counts of the connected workspace: { status, fileCount, summarisedCount, hasWiki, wikiVersion }. Run `npx bystep sync --plan` / `npx bystep sync` from the CLI to update the index.', inputSchema: { workspaceId: z.string().optional().describe('Workspace id. Defaults to BYSTEP_WORKSPACE_ID or .bystep/config.json workspaceId.') } }, wrap(async ({ workspaceId }) => {
    const id = workspaceId || defaultWorkspaceId()
    if (!id) throw new ApiError(400, 'workspaceId required (pass it, set BYSTEP_WORKSPACE_ID, or run `npx bystep connect`)', 'bad_request')
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
