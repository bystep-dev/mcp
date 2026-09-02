import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/index.js'

// In-process client ↔ server over the SDK's in-memory transport (no network, no token needed for tools/list).
async function connected() {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const server = createServer()
  await server.connect(serverT)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientT)
  return { client, close: () => Promise.all([client.close(), server.close()]) }
}

test('initialize + tools/list exposes the seven Bystep tools', async () => {
  const { client, close } = await connected()
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), ['plan_get', 'plan_list', 'sync_status', 'task_complete', 'task_fail', 'task_next', 'task_start'])
  const fail = tools.find((t) => t.name === 'task_fail')
  assert.deepEqual(fail.inputSchema.required.sort(), ['reason', 'ref'])
  await close()
})

test('tools/call without a token returns an isError result instead of throwing', async () => {
  const prev = { token: process.env.BYSTEP_TOKEN, cfg: process.env.BYSTEP_CONFIG_DIR, plan: process.env.BYSTEP_PLAN_ID }
  process.env.BYSTEP_TOKEN = ''
  process.env.BYSTEP_CONFIG_DIR = '/nonexistent/bystep-cfg'
  process.env.BYSTEP_PLAN_ID = '00000000-0000-0000-0000-000000000000'
  try {
    const { client, close } = await connected()
    const r = await client.callTool({ name: 'task_next', arguments: {} })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /401 .*BYSTEP_TOKEN/)
    const r2 = await client.callTool({ name: 'sync_status', arguments: {} })
    assert.equal(r2.isError, true)
    assert.match(r2.content[0].text, /workspaceId required/)
    await close()
  } finally {
    for (const [k, v] of [['BYSTEP_TOKEN', prev.token], ['BYSTEP_CONFIG_DIR', prev.cfg], ['BYSTEP_PLAN_ID', prev.plan]]) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
})
