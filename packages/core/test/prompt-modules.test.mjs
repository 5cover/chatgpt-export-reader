import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { createRecapPrompt } from '../dist/index.js'

test('selected modules follow fixed order and do not duplicate the evidence core', () => {
  const prompt = createRecapPrompt('yaml', ['room', 'themes'])
  assert.ok(prompt.includes('parentId'))
  assert.ok(prompt.indexOf('## Recurring themes') < prompt.indexOf('## Room portrait'))
  assert.ok(prompt.split('preWindowContext').length - 1 >= 2)
  assert.ok(prompt.includes('If an empty-room image is attached'))
  assert.ok(prompt.includes('otherwise create a room from scratch'))
})

test('legacy CLI prompt remains available by default', () => {
  const prompt = createRecapPrompt('toon')
  assert.ok(prompt.startsWith('# ChatGPT Usage Recap: Investigator Prompt'))
  assert.ok(prompt.includes('TOON'))
  assert.throws(() => createRecapPrompt('yaml', ['unknown']), RangeError)
})

test('context format schema is always present and cannot be deselected', () => {
  const prompt = createRecapPrompt('yaml', [])
  assert.ok(prompt.includes('## Context format'))
  assert.ok(prompt.includes('required:'))
  assert.ok(prompt.includes('parentId'))
  assert.ok(prompt.includes('## Analysis procedure'))
  assert.ok(prompt.includes('every partition'))
  assert.match(createRecapPrompt('yaml-anchors', []), /YAML with anchors file/)
})
