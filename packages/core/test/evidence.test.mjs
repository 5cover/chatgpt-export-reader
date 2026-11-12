import assert from 'node:assert/strict'
import test from 'node:test'
import { collectRepeatedPhrases, findConversationTurns } from '../dist/index.js'
const chats = [
  {
    id: 'evidence',
    title: 'Punctuation',
    createTime: 1,
    updateTime: 2,
    isArchived: false,
    messages: ['Hello,\nworld!', 'Hello world.', 'Hello worlds'].map((body, index) => ({
      id: String(index),
      role: 'user',
      body,
      createTime: index + 1,
      weight: 1,
      children: [],
    })),
  },
]
test('repeated phrase evidence uses the same word segmentation across punctuation and spacing', () => {
  const phrases = collectRepeatedPhrases(chats)
  const phrase = phrases.user.find(phrase => phrase.phrase.toLowerCase() === 'hello world')
  assert.ok(phrase)
  const matches = findConversationTurns(chats, {}, 0, 50, phrase.phrase, 'word-sequence')
  assert.equal(matches.total, 2)
  assert.equal(findConversationTurns(chats, {}, 0, 50, phrase.phrase).total, 2)
  assert.equal(
    matches.turns.some(turn => turn.preview === 'Hello worlds'),
    false
  )
})
