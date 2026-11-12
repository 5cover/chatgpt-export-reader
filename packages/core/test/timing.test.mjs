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

test('usage intervals split at local midnight and honor the date filter', () => {
  const start = Date.parse('2026-01-02T00:00:01Z')
  const result = collectTiming([chat([message('u', 'user', start)])], { timeZone: 'UTC', startDate: '2026-01-02' })
  assert.deepEqual(result.days.map(day => day.id), ['2026-01-02'])
  assert.equal(result.summary.usageMs, 1000)
  assert.equal(result.projects[0].usageMs, 1000)
})

test('deep conversation trees do not overflow timing traversal', () => {
  const start = Date.parse('2026-01-01T12:00:00Z')
  const root = message('0', 'assistant', start)
  let current = root
  for (let index = 1; index < 3000; index++) {
    const child = message(String(index), 'assistant', start + index * 1000)
    current.children = [child]
    current = child
  }
  assert.equal(collectTiming([chat([root])]).summary.unmatchedPrompts, 0)
})

test('untimed prompts are reported without fabricating latency', () => {
  const result = collectTiming([chat([message('u', 'user', undefined)])])
  assert.equal(result.summary.invalidPrompts, 1)
  assert.equal(result.projects[0].invalidPrompts, 1)
  assert.equal(result.summary.thinkingMs, 0)
})
