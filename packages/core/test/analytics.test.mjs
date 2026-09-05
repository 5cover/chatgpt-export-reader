import assert from 'node:assert/strict'
import test from 'node:test'
import { collectAnalytics, collectConversationDetail, findConversationTurns, getMessageContents } from '../dist/analytics.js'

const at = (hour, minute = 0) => Date.UTC(2025, 0, 1, hour, minute)
const message = (id, role, body, createTime) => ({ id, role, body, weight: 1, createTime, children: [] })
const chat = (id, messages) => ({ id, title: id, createTime: at(0), updateTime: at(0), messages, isArchived: false })

test('analytics counts user and assistant text separately and splits sessions by the configured gap', () => {
    const value = collectAnalytics([chat('one', [
        message('u1', 'user', 'Hello, world! café', at(9)),
        message('a1', 'assistant', 'A short response.', at(9, 30)),
        message('u2', 'user', 'Second session', at(10, 31)),
    ])], { timeZone: 'UTC', sessionGapMinutes: 60 })

    assert.equal(value.summary.prompts, 2)
    assert.equal(value.summary.input.words, 5)
    assert.equal(value.summary.output.words, 3)
    assert.equal(value.summary.input.characters, 'Hello, world! café'.length + 'Second session'.length)
    assert.equal(value.summary.sessions, 2)
    assert.deepEqual(value.sessions.map(session => session.prompts), [1, 1])
})

test('analytics cutoff excludes pre-range and untimestamped text from filtered analysis', () => {
    const value = collectAnalytics([chat('one', [
        message('old', 'user', 'old words', Date.UTC(2024, 11, 31, 23)),
        message('unknown', 'assistant', 'unplaced output'),
        message('new', 'assistant', 'new output words', at(1)),
    ])], { timeZone: 'UTC', startDate: '2025-01-01' })

    assert.equal(value.summary.messages, 1)
    assert.equal(value.summary.input.words, 0)
    assert.equal(value.summary.output.words, 3)
    assert.deepEqual(value.days.map(day => day.date), ['2025-01-01'])
})

test('conversation evidence pages literal previews and returns bodies only for selected IDs', () => {
    const source = [chat('one', [
        message('u1', 'user', 'Find the important phrase here', at(9)),
        message('a1', 'assistant', 'This is the full generated response.', at(9, 2)),
    ])]
    const detail = collectConversationDetail(source, { timeZone: 'UTC' })
    const page = findConversationTurns(source, { timeZone: 'UTC' }, 0, 50, 'important')

    assert.equal(detail?.totalTurns, 2)
    assert.equal(page.total, 1)
    assert.match(page.turns[0].preview, /important phrase/)
    assert.equal(getMessageContents(source, { timeZone: 'UTC' }, [page.turns[0].id])[0].body, 'Find the important phrase here')
})

test('analytics rejects invalid cutoff dates', () => {
    assert.throws(() => collectAnalytics([], { startDate: '2025-02-30' }), /Invalid start date/)
})
