// Local runner for acceptance criteria (moat plan §3.2/§3.6). Mirrors the CLI's `task verify` semantics
// and the server's own redaction (src/lib/evidence.server.ts) so evidence uploaded from MCP looks the
// same as evidence uploaded from the CLI. No playwright here — screenshot criteria are always skipped.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REDACT_RE = /((?:sk|bs|ghp|gho|xox[abp]|AKIA|AIza)[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----|(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+)/gi
const CAP = 4000

/** Redact secrets, then keep only the LAST `CAP` chars (the tail — e.g. failing assertions — is usually what matters). */
export function redact(s) {
  const str = String(s ?? '')
  const tail = str.length > CAP ? str.slice(-CAP) : str
  return tail.replace(REDACT_RE, '[REDACTED]')
}

/** Repo root the criteria run against: BYSTEP_REPO_ROOT, else cwd. Distinct from config.js's `repoRoot()`
 * (which walks up looking for `.bystep/config.json` to resolve plan/workspace defaults). */
export const verifyRepoRoot = () => process.env.BYSTEP_REPO_ROOT || process.cwd()

export const pendingTaskFile = (root) => path.join(root, '.bystep', 'pending-task.json')

export function readPendingTask(root) {
  try {
    return JSON.parse(fs.readFileSync(pendingTaskFile(root), 'utf8'))
  } catch {
    return null
  }
}

export function writePendingTask(root, data) {
  try {
    fs.mkdirSync(path.join(root, '.bystep'), { recursive: true })
    fs.writeFileSync(pendingTaskFile(root), JSON.stringify(data, null, 2))
    return true
  } catch {
    return false
  }
}

function git(root, args, timeoutMs = 10000) {
  try {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: timeoutMs })
    if (r.status !== 0 || r.error) return null
    return (r.stdout ?? '').trim()
  } catch {
    return null
  }
}

export function gitHead(root) {
  return git(root, ['rev-parse', 'HEAD']) || undefined
}

/** commitHash / diffStat / filesTouched, best-effort (no git repo, or no commits yet → omit each). */
export function gitInfo(root, base = 'HEAD') {
  const out = {}
  const commitHash = gitHead(root)
  if (commitHash) out.commitHash = commitHash
  const shortstat = git(root, ['diff', '--shortstat', base])
  if (shortstat !== null) {
    const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(shortstat)
    out.diffStat = m ? { files: Number(m[1] || 0), add: Number(m[2] || 0), del: Number(m[3] || 0) } : { files: 0, add: 0, del: 0 }
  }
  const names = git(root, ['diff', '--name-only', base])
  if (names !== null) {
    const list = names.split('\n').filter(Boolean).slice(0, 200)
    out.filesTouched = list
  }
  return out
}

async function runHttp(criterion, timeoutMs = 30000) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(criterion.cmd, { signal: controller.signal })
    const body = await res.text().catch(() => '')
    const durationMs = Date.now() - started
    let ok
    if (criterion.expect !== undefined && /^\d+$/.test(criterion.expect.trim())) {
      ok = res.status === Number(criterion.expect.trim())
    } else if (criterion.expect) {
      ok = res.ok && body.includes(criterion.expect)
    } else {
      ok = res.ok
    }
    return { id: criterion.id, kind: criterion.kind, ok, output: redact(`HTTP ${res.status}\n${body}`), durationMs }
  } catch (e) {
    return { id: criterion.id, kind: criterion.kind, ok: false, output: redact(String(e?.message ?? e)), durationMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

function runFile(criterion, root) {
  const started = Date.now()
  const list = (criterion.cmd ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const missing = list.filter((p) => !fs.existsSync(path.isAbsolute(p) ? p : path.join(root, p)))
  return { id: criterion.id, kind: criterion.kind, ok: list.length > 0 && missing.length === 0, output: redact(missing.length ? `missing: ${missing.join(', ')}` : `found: ${list.join(', ')}`), durationMs: Date.now() - started }
}

function runShell(criterion, root, timeoutSeconds) {
  const started = Date.now()
  const timeoutMs = (timeoutSeconds ?? 600) * 1000
  const r = spawnSync(criterion.cmd, { cwd: root, shell: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 })
  const durationMs = Date.now() - started
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const timedOut = r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT'
  const ok = !timedOut && r.status === 0 && (!criterion.expect || out.includes(criterion.expect))
  const output = timedOut ? `${out}\n[timed out after ${timeoutSeconds ?? 600}s]` : r.error ? `${out}\n${r.error.message}` : out
  return { id: criterion.id, kind: criterion.kind, ok, output: redact(output), durationMs }
}

/** Run ONE acceptance criterion locally. Never throws — a runner error becomes ok:false with the error as output. */
export async function runCriterion(criterion, { root, skip = [], timeoutSeconds } = {}) {
  if (skip.includes(criterion.id)) return { id: criterion.id, kind: criterion.kind, ok: false, skipped: true, output: 'skipped by caller' }
  try {
    switch (criterion.kind) {
      case 'test':
      case 'build':
      case 'lint':
        return runShell(criterion, root ?? verifyRepoRoot(), timeoutSeconds)
      case 'http':
        return runHttp(criterion)
      case 'file':
        return runFile(criterion, root ?? verifyRepoRoot())
      case 'screenshot':
        return { id: criterion.id, kind: criterion.kind, ok: false, skipped: true, output: 'screenshot needs the CLI' }
      case 'manual':
        return { id: criterion.id, kind: criterion.kind, ok: false, skipped: true, output: 'needs a human' }
      default:
        return { id: criterion.id, kind: criterion.kind, ok: false, skipped: true, output: `unknown criterion kind: ${criterion.kind}` }
    }
  } catch (e) {
    return { id: criterion.id, kind: criterion.kind, ok: false, output: redact(String(e?.message ?? e)) }
  }
}

/**
 * Run every acceptance criterion of a task and collect the evidence payload (moat plan §3.6).
 * Reads `.bystep/pending-task.json` (written by task_start) when present and matches `ref`, to compute
 * `durationMs` and to diff against `headBefore` (everything since the task started) instead of bare HEAD.
 */
export async function runAcceptance(acceptance, { ref, skip = [], timeoutSeconds, root } = {}) {
  root = root || verifyRepoRoot()
  const results = []
  for (const criterion of acceptance) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runCriterion(criterion, { root, skip, timeoutSeconds }))
  }
  const pending = readPendingTask(root)
  const usePending = pending && (!ref || pending.ref === ref)
  const base = (usePending && pending.headBefore) || 'HEAD'
  const info = gitInfo(root, base)
  const durationMs = usePending && pending.startedAt ? Math.max(0, Date.now() - Date.parse(pending.startedAt)) : undefined
  return { results, ...info, ...(durationMs !== undefined && !Number.isNaN(durationMs) ? { durationMs } : {}) }
}
