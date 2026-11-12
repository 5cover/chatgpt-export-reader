import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { collectTiming } from '../dist/index.js'

const message = (id, role, at, children = []) => ({ id, role, body: 'one two three', weight: 1, createTime: at, children })
const chat = messages => ({ id: 'chat', title: 'Chat', createTime: 0, updateTime: 0, projectName: 'project', isArchived: false, messages })

test('first branch reply is counted once and long waits are separate', () => {
  const start = Date.parse('2026-01-01T12:00:00Z')
  const quick = message('a', 'assistant', start + 5000)
  const slow = message('b', 'assistant', start + 3_600_000)
  const prompt = message('u', 'user', start, [slow, quick])
  const result = collectTiming([chat([prompt])])
  assert.equal(result.summary.thinkingMs, 5000)
  assert.equal(result.summary.longWaits, 0)
  assert.equal(result.projects[0].thinkingMs, 5000)
  assert.ok(result.summary.usageMs > 0)
})

test('intervening user and missing reply do not create false pairs', () => {
  const start = Date.parse('2026-01-01T12:00:00Z')
  const prompt = message('u', 'user', start, [message('u2', 'user', start + 1000, [message('a', 'assistant', start + 2000)])])
  const result = collectTiming([chat([prompt])])
  assert.equal(result.summary.thinkingMs, 1000)
  assert.equal(result.summary.unmatchedPrompts, 1)
})

test('long reply delay is excluded from headline', () => {
  const start = Date.parse('2026-01-01T12:00:00Z')
  const result = collectTiming([chat([message('u', 'user', start, [message('a', 'assistant', start + 3_600_000)])])])
  assert.equal(result.summary.thinkingMs, 0)
  assert.equal(result.summary.longWaitMs, 3_600_000)
  assert.equal(result.summary.longWaits, 1)
})
