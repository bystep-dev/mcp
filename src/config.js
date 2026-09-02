// Mirrors packages/cli/src/config.js so the MCP server reuses the CLI's saved login and repo binding.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}
const globalDir = () => process.env.BYSTEP_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'bystep')
export const getGlobal = () => readJson(path.join(globalDir(), 'config.json'), {})
export const apiUrl = () => (process.env.BYSTEP_API_URL || getGlobal().apiUrl || 'https://bystep.dev').replace(/\/$/, '')
export const token = () => process.env.BYSTEP_TOKEN || getGlobal().token || ''

export function repoRoot(start = process.env.BYSTEP_REPO || process.cwd()) {
  let dir = start
  for (;;) {
    if (fs.existsSync(path.join(dir, '.bystep', 'config.json')) || fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}
export const getRepo = () => readJson(path.join(repoRoot(), '.bystep', 'config.json'), null)
export const defaultPlanId = () => process.env.BYSTEP_PLAN_ID || getRepo()?.planId || ''
export const defaultWorkspaceId = () => process.env.BYSTEP_WORKSPACE_ID || getRepo()?.workspaceId || ''
