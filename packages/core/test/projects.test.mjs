import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { collectAnalytics } from '../dist/index.js'

const at = Date.parse('2026-01-02T12:00:00Z')
function chat(id, projectName, role, body, createTime = at) {
  return { id, title: id, projectName, createTime: at, updateTime: at, isArchived: false,
    messages: [{ id: `${id}-message`, role, body, weight: 1, createTime, children: [] }] }
}

test('project totals and days follow analytics filtering and retain unassigned chats', () => {
  const result = collectAnalytics([
    chat('a', 'project-1', 'user', 'two words'),
    chat('b', 'project-1', 'assistant', 'response text'),
    chat('c', undefined, 'user', 'unassigned'),
    chat('d', 'project-1', 'user', 'old', at - 86_400_000),
  ], { startDate: '2026-01-02' })
  const project = result.projects.find(value => value.id === 'project-1')
  assert.equal(project.chats, 2)
  assert.equal(project.messages, 2)
  assert.equal(project.prompts, 1)
  assert.equal(project.input.words, 2)
  assert.equal(project.output.words, 2)
  assert.deepEqual(project.days.map(day => [day.date, day.messages]), [['2026-01-02', 2]])
  assert.equal(result.projects.find(value => value.id === '').prompts, 1)
})
