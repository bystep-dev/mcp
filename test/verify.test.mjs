import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { runCriterion, runAcceptance, redact, gitInfo, writePendingTask, readPendingTask } from '../src/verify.js'

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bystep-mcp-verify-'))

test('redact: masks secret-looking tokens, secret= assignments and PEM blocks', () => {
  assert.equal(redact('key sk-abcdefghijklmno leaked'), 'key [REDACTED] leaked')
  assert.equal(redact('token=hunter2verysecret'), '[REDACTED]')
  assert.match(redact('before -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nafter'), /^before \[REDACTED\]\s*after$/)
})

test('redact: keeps only the LAST 4000 chars', () => {
  const s = 'a'.repeat(5000) + 'TAIL' + 'b'.repeat(5000)
  const out = redact(s)
  assert.equal(out.length, 4000)
  assert.equal(out, 'b'.repeat(4000))
  assert.ok(!out.includes('TAIL')) // TAIL falls outside the last 4000 chars
})

test('file criterion: passes only when every comma-separated path exists', async () => {
  const root = tmpdir()
  fs.writeFileSync(path.join(root, 'a.txt'), 'x')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'y')

  const ok = await runCriterion({ id: 'AC-1', kind: 'file', cmd: 'a.txt, sub/b.txt', text: 't' }, { root })
  assert.equal(ok.ok, true)
  assert.equal(ok.skipped, undefined)

  const missing = await runCriterion({ id: 'AC-2', kind: 'file', cmd: 'a.txt, nope.txt', text: 't' }, { root })
  assert.equal(missing.ok, false)
  assert.match(missing.output, /nope\.txt/)
})

test('test/build/lint criterion: exit code and expect-substring semantics', async () => {
  const root = tmpdir()
  const pass = await runCriterion({ id: 'AC-1', kind: 'test', cmd: 'echo PASS && exit 0', text: 't' }, { root })
  assert.equal(pass.ok, true)
  assert.equal(pass.kind, 'test')
  assert.match(pass.output, /PASS/)

  const failExit = await runCriterion({ id: 'AC-2', kind: 'build', cmd: 'echo oops && exit 1', text: 't' }, { root })
  assert.equal(failExit.ok, false)

  const wrongOutput = await runCriterion({ id: 'AC-3', kind: 'lint', cmd: 'echo NOPE && exit 0', expect: 'PASS', text: 't' }, { root })
  assert.equal(wrongOutput.ok, false, 'exit 0 but expect substring missing must still fail')

  const rightOutput = await runCriterion({ id: 'AC-4', kind: 'test', cmd: 'echo ALL PASS && exit 0', expect: 'PASS', text: 't' }, { root })
  assert.equal(rightOutput.ok, true)
})

test('test criterion output is redacted before being returned', async () => {
  const root = tmpdir()
  const r = await runCriterion({ id: 'AC-1', kind: 'test', cmd: 'echo token=supersecretvalue123 && exit 0', text: 't' }, { root })
  assert.ok(!r.output.includes('supersecretvalue123'))
  assert.match(r.output, /\[REDACTED\]/)
})

test('screenshot and manual criteria are always skipped, never block pass', async () => {
  const shot = await runCriterion({ id: 'AC-1', kind: 'screenshot', cmd: '/x', text: 't' }, { root: tmpdir() })
  assert.deepEqual([shot.ok, shot.skipped, shot.output], [false, true, 'screenshot needs the CLI'])

  const manual = await runCriterion({ id: 'AC-2', kind: 'manual', text: 't' }, { root: tmpdir() })
  assert.deepEqual([manual.ok, manual.skipped, manual.output], [false, true, 'needs a human'])
})

test('skip list short-circuits a criterion regardless of kind', async () => {
  const r = await runCriterion({ id: 'AC-1', kind: 'test', cmd: 'exit 1', text: 't' }, { root: tmpdir(), skip: ['AC-1'] })
  assert.equal(r.skipped, true)
  assert.equal(r.ok, false)
})

test('http criterion: numeric expect matches status, non-numeric expect matches body substring', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello world')
    } else {
      res.writeHead(404)
      res.end('nope')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const byStatus = await runCriterion({ id: 'AC-1', kind: 'http', cmd: `http://127.0.0.1:${port}/ok`, expect: '200', text: 't' }, {})
    assert.equal(byStatus.ok, true)

    const byBody = await runCriterion({ id: 'AC-2', kind: 'http', cmd: `http://127.0.0.1:${port}/ok`, expect: 'hello', text: 't' }, {})
    assert.equal(byBody.ok, true)

    const wrongStatus = await runCriterion({ id: 'AC-3', kind: 'http', cmd: `http://127.0.0.1:${port}/missing`, expect: '200', text: 't' }, {})
    assert.equal(wrongStatus.ok, false)
  } finally {
    server.close()
  }
})

test('runAcceptance: aggregates results and includes best-effort git info when the repo has commits', async () => {
  const root = tmpdir()
  fs.writeFileSync(path.join(root, 'README.md'), 'hi')
  const { spawnSync } = await import('node:child_process')
  spawnSync('git', ['init', '-q'], { cwd: root })
  spawnSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root })
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root })
  spawnSync('git', ['add', '.'], { cwd: root })
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root })
  fs.writeFileSync(path.join(root, 'new.txt'), 'changed')
  spawnSync('git', ['add', '.'], { cwd: root })

  const out = await runAcceptance([{ id: 'AC-1', kind: 'file', cmd: 'README.md', text: 't' }], { ref: 'x', root })
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].ok, true)
  assert.ok(out.commitHash)
  assert.ok(out.diffStat)
  assert.ok(out.filesTouched.includes('new.txt'))
})

test('runAcceptance: no git repo → commitHash/diffStat/filesTouched are omitted, not thrown', async () => {
  const root = tmpdir() // no `git init`
  const out = await runAcceptance([{ id: 'AC-1', kind: 'file', cmd: 'README.md', text: 't' }], { ref: 'x', root })
  const g = gitInfo(root)
  assert.equal(g.commitHash, undefined)
  assert.equal(g.diffStat, undefined)
  assert.equal(g.filesTouched, undefined)
  assert.ok(Array.isArray(out.results))
})

test('pending-task.json round-trip: written by writePendingTask, read back by readPendingTask', () => {
  const root = tmpdir()
  const data = { ref: 'r1', startedAt: new Date().toISOString(), headBefore: 'abc123' }
  assert.equal(writePendingTask(root, data), true)
  const back = readPendingTask(root)
  assert.deepEqual(back, data)
  assert.equal(fs.existsSync(path.join(root, '.bystep', 'pending-task.json')), true)
})

test('readPendingTask: missing file returns null instead of throwing', () => {
  assert.equal(readPendingTask(tmpdir()), null)
})
