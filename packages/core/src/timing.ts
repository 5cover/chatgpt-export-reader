import type { Chat, Message } from './types.js'

export type TimingTotals = { usageMs: number; thinkingMs: number; longWaitMs: number; longWaits: number; unmatchedPrompts: number }
export type TimingBreakdown = TimingTotals & { id: string; title: string; projectId?: string }
export type TimingStatistics = {
  summary: TimingTotals
  days: Array<TimingBreakdown>
  projects: Array<TimingBreakdown>
  projectDays: Array<TimingBreakdown & { projectId: string; date: string }>
  conversations: Array<TimingBreakdown>
}

type Span = { start: number; end: number; project: string; chat: string }
const empty = (): TimingTotals => ({ usageMs: 0, thinkingMs: 0, longWaitMs: 0, longWaits: 0, unmatchedPrompts: 0 })
const valid = (value?: number): value is number => value !== undefined && Number.isFinite(value) && Number.isFinite(new Date(value).getTime())
const estimate = (message: Message): number => Math.min(900_000, Math.max(3_000, Math.ceil(message.body.trim().split(/\s+/u).filter(Boolean).length / (message.role === 'user' ? 40 : 200) * 60_000)))

export function collectTiming(chats: Iterable<Chat>, options: { timeZone?: string; startDate?: string; endDate?: string } = {}): TimingStatistics {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: options.timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  const dayKey = (at: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  const days = new Map<string, TimingBreakdown>()
  const projects = new Map<string, TimingBreakdown>()
  const projectDays = new Map<string, TimingBreakdown & { projectId: string; date: string }>()
  const conversations = new Map<string, TimingBreakdown>()
  const spans: Span[] = []
  const get = (map: Map<string, TimingBreakdown>, id: string, title = id) => {
    let value = map.get(id)
    if (!value) { value = { id, title, ...empty() }; map.set(id, value) }
    return value
  }
  const include = (at: number) => (!options.startDate || dayKey(at) >= options.startDate) && (!options.endDate || dayKey(at) <= options.endDate)
  for (const chat of chats) {
    const project = chat.projectName ?? ''
    const ownSpans = new Map<Message, Span>()
    const seen = new Set<Message>()
    const stack = [...chat.messages].reverse()
    while (stack.length) {
      const message = stack.pop()!
      if (seen.has(message)) continue
      seen.add(message)
      const at = message.createTime
      if (valid(at) && include(at) && (message.role === 'user' || message.role === 'assistant')) {
        const ms = estimate(message)
        const span = { start: message.role === 'user' ? at - ms : at, end: message.role === 'user' ? at : at + ms, project, chat: chat.id }
        spans.push(span)
        ownSpans.set(message, span)
      }
      if (message.role === 'user' && valid(at) && include(at)) {
        const queue = [...message.children]
        let reply: Message | undefined
        const branchSeen = new Set<Message>()
        while (queue.length) {
          const child = queue.shift()!
          if (branchSeen.has(child) || child.role === 'user') continue
          branchSeen.add(child)
          if (child.role === 'assistant' && valid(child.createTime) && child.createTime >= at && (!reply || child.createTime < reply.createTime!)) reply = child
          queue.push(...child.children)
        }
        const conversation = get(conversations, chat.id, chat.title)
        conversation.projectId = project
        const targets = [get(days, dayKey(at)), get(projects, project, project || 'Unassigned'), conversation]
        const pdKey = `${project}\u0000${dayKey(at)}`
        let pd = projectDays.get(pdKey)
        if (!pd) { pd = { id: pdKey, title: project || 'Unassigned', projectId: project, date: dayKey(at), ...empty() }; projectDays.set(pdKey, pd) }
        targets.push(pd)
        if (!reply) targets.forEach(target => target.unmatchedPrompts++)
        else {
          const duration = reply.createTime! - at
          targets.forEach(target => {
            if (duration <= 1_800_000) target.thinkingMs += duration
            else { target.longWaitMs += duration; target.longWaits++ }
          })
        }
      }
      for (let index = message.children.length - 1; index >= 0; index--) stack.push(message.children[index]!)
    }
    // A reply-to-next-prompt gap is evidence of possible reading and typing.
    // Allow at most twice the text-based budget, leaving any remaining gap idle.
    for (const [assistant, reading] of ownSpans) {
      if (assistant.role !== 'assistant' || !valid(assistant.createTime)) continue
      const next = assistant.children.filter(child => child.role === 'user' && ownSpans.has(child) && valid(child.createTime) && child.createTime >= assistant.createTime!).sort((a, b) => a.createTime! - b.createTime!)[0]
      if (!next) continue
      const typing = ownSpans.get(next)!
      const gap = next.createTime! - assistant.createTime
      if (gap <= 0) continue
      const readWeight = reading.end - reading.start
      const typeWeight = typing.end - typing.start
      const budget = Math.min(gap, 900_000, 2 * (readWeight + typeWeight))
      const readMs = Math.round(budget * readWeight / (readWeight + typeWeight))
      reading.end = reading.start + readMs
      typing.start = typing.end - (budget - readMs)
    }
  }
  // Resolve overlaps deterministically, so the headline remains additive across projects.
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  let coveredUntil = -Infinity
  for (const span of spans) {
    let start = Math.max(span.start, coveredUntil)
    if (start >= span.end) continue
    coveredUntil = span.end
    while (start < span.end) {
      const date = dayKey(start)
      let end = span.end
      // Calendar-day boundaries are found by binary search, including DST days.
      if (dayKey(end - 1) !== date) {
        let low = start + 1, high = end
        while (low < high) { const mid = Math.floor((low + high) / 2); if (dayKey(mid) === date) low = mid + 1; else high = mid }
        end = low
      }
      const duration = end - start
      if (include(start)) {
        get(days, date).usageMs += duration
        get(projects, span.project, span.project || 'Unassigned').usageMs += duration
        const pdKey = `${span.project}\u0000${date}`
        let pd = projectDays.get(pdKey)
        if (!pd) { pd = { id: pdKey, title: span.project || 'Unassigned', projectId: span.project, date, ...empty() }; projectDays.set(pdKey, pd) }
        pd.usageMs += duration
        const conversation = get(conversations, span.chat)
        conversation.projectId = span.project
        conversation.usageMs += duration
      }
      start = end
    }
  }
  const summary = empty()
  for (const day of days.values()) for (const key of Object.keys(summary) as Array<keyof TimingTotals>) summary[key] += day[key]
  return { summary, days: [...days.values()].sort((a, b) => a.id.localeCompare(b.id)), projects: [...projects.values()].sort((a, b) => b.usageMs - a.usageMs), projectDays: [...projectDays.values()], conversations: [...conversations.values()] }
}
