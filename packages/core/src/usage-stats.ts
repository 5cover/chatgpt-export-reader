import type { Chat, Message } from './types.js'

export type UsageStatistics = {
    summary: UsageSummary
    days: UsageDay[]
    roles: UsageRole[]
    conversations: ConversationSummary[]
}

export type UsageSummary = {
    chats: number
    messages: number
    timestampedMessages: number
    untimestampedMessages: number
    prompts: number
    assistantMessages: number
    firstMessageAt?: string
    lastMessageAt?: string
    activeDays: number
}

export type UsageDay = {
    date: string
    messages: number
    prompts: number
    assistantMessages: number
    otherMessages: number
    activeChats: number
    conversations: UsageConversation[]
}

export type UsageConversation = {
    id: string
    title: string
    messages: number
    prompts: number
    assistantMessages: number
    otherMessages: number
}

export type UsageConversationInput = {
    id: string
    title: string
    messages: Iterable<UsageMessageInput>
}

export type UsageMessageInput = {
    role: string
    createTime?: number
}

export type UsageRole = {
    role: string
    messages: number
}

export type ConversationSummary = {
    id: string
    title: string
    messages: number
    roles: UsageRole[]
    firstMessageAt?: string
    lastMessageAt?: string
    lifetimeMs?: number
    activeDays: number
}

export type ConversationTimelineEvent = {
    id: string
    role: string
    createTime: number
}

type MutableUsageConversation = UsageConversation
type MutableConversationSummary = Omit<ConversationSummary, 'roles' | 'firstMessageAt' | 'lastMessageAt' | 'lifetimeMs' | 'activeDays'> & {
    roles: Map<string, number>
    dates: Set<string>
    firstTimestamp?: number
    lastTimestamp?: number
}
type MutableUsageDay = Omit<UsageDay, 'activeChats' | 'conversations'> & {
    conversations: Map<string, MutableUsageConversation>
}

export class UsageStatsAccumulator {
    private readonly summary: UsageSummary = {
        chats: 0,
        messages: 0,
        timestampedMessages: 0,
        untimestampedMessages: 0,
        prompts: 0,
        assistantMessages: 0,
        activeDays: 0,
    }
    private readonly days = new Map<string, MutableUsageDay>()
    private readonly roles = new Map<string, number>()
    private readonly conversations = new Map<string, MutableConversationSummary>()
    private firstTimestamp: number | undefined
    private lastTimestamp: number | undefined
    private readonly dayFormatter: Intl.DateTimeFormat

    constructor(timeZone = 'UTC') {
        this.dayFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
    }

    addChat(chat: Chat): void {
        this.addConversation({
            id: chat.id,
            title: chat.title,
            messages: walkMessages(chat.messages),
        })
    }

    addConversation(conversation: UsageConversationInput): void {
        this.summary.chats++
        const summary = this.conversations.get(conversation.id) ?? createConversationSummary(conversation)
        this.conversations.set(conversation.id, summary)
        for (const message of conversation.messages) this.addMessage(conversation, message, summary)
    }

    finish(): UsageStatistics {
        const days = this.fillDays()
        return {
            summary: {
                ...this.summary,
                firstMessageAt: this.firstTimestamp === undefined ? undefined : new Date(this.firstTimestamp).toISOString(),
                lastMessageAt: this.lastTimestamp === undefined ? undefined : new Date(this.lastTimestamp).toISOString(),
                activeDays: days.filter(day => day.messages > 0).length,
            },
            days,
            roles: [...this.roles]
                .map(([role, messages]) => ({ role, messages }))
                .sort((a, b) => b.messages - a.messages || a.role.localeCompare(b.role)),
            conversations: [...this.conversations.values()]
                .map(toConversationSummary)
                .sort((a, b) => b.messages - a.messages || a.title.localeCompare(b.title)),
        }
    }

    private addMessage(conversation: UsageConversationInput, message: UsageMessageInput, summary: MutableConversationSummary): void {
        this.summary.messages++
        summary.messages++
        summary.roles.set(message.role, (summary.roles.get(message.role) ?? 0) + 1)
        this.roles.set(message.role, (this.roles.get(message.role) ?? 0) + 1)
        if (message.role === 'user') this.summary.prompts++
        if (message.role === 'assistant') this.summary.assistantMessages++

        const timestamp = message.createTime
        if (timestamp === undefined || !isValidTimestamp(timestamp)) {
            this.summary.untimestampedMessages++
            return
        }

        this.summary.timestampedMessages++
        summary.firstTimestamp = summary.firstTimestamp === undefined ? timestamp : Math.min(summary.firstTimestamp, timestamp)
        summary.lastTimestamp = summary.lastTimestamp === undefined ? timestamp : Math.max(summary.lastTimestamp, timestamp)
        this.firstTimestamp = this.firstTimestamp === undefined ? timestamp : Math.min(this.firstTimestamp, timestamp)
        this.lastTimestamp = this.lastTimestamp === undefined ? timestamp : Math.max(this.lastTimestamp, timestamp)

        const date = this.dayKey(timestamp)
        summary.dates.add(date)
        const day = this.days.get(date) ?? createDay(date)
        this.days.set(date, day)
        day.messages++
        if (message.role === 'user') day.prompts++
        else if (message.role === 'assistant') day.assistantMessages++
        else day.otherMessages++

        const dayConversation = day.conversations.get(conversation.id) ?? createConversation(conversation)
        day.conversations.set(conversation.id, dayConversation)
        dayConversation.messages++
        if (message.role === 'user') dayConversation.prompts++
        else if (message.role === 'assistant') dayConversation.assistantMessages++
        else dayConversation.otherMessages++
    }

    private fillDays(): UsageDay[] {
        if (this.firstTimestamp === undefined || this.lastTimestamp === undefined) return []

        const days: UsageDay[] = []
        const current = new Date(this.firstTimestamp)
        current.setUTCHours(12, 0, 0, 0)
        const endDate = this.dayKey(this.lastTimestamp)

        while (true) {
            const date = this.dayKey(current.getTime())
            const day = this.days.get(date) ?? createDay(date)
            days.push(toUsageDay(day))
            if (date === endDate) return days
            current.setUTCDate(current.getUTCDate() + 1)
        }
    }

    private dayKey(timestamp: number): string {
        const parts = this.dayFormatter.formatToParts(timestamp)
        const value = new Map(parts.map(part => [part.type, part.value]))
        return `${value.get('year')!}-${value.get('month')!}-${value.get('day')!}`
    }
}

export function conversationTimeline(chat: Chat): ConversationTimelineEvent[] {
    return [...walkMessages(chat.messages)]
        .flatMap(message => message.createTime === undefined || !isValidTimestamp(message.createTime) ? [] : [{ id: message.id, role: message.role, createTime: message.createTime }])
        .sort((a, b) => a.createTime - b.createTime)
}

export async function collectUsageStatistics(chats: AsyncIterable<Chat>, timeZone = 'UTC'): Promise<UsageStatistics> {
    const accumulator = new UsageStatsAccumulator(timeZone)
    for await (const chat of chats) accumulator.addChat(chat)
    return accumulator.finish()
}

function* walkMessages(roots: readonly Message[]): Generator<Message> {
    const seen = new Set<Message>()
    const stack = [...roots].reverse()
    while (stack.length > 0) {
        const message = stack.pop()!
        if (seen.has(message)) continue
        seen.add(message)
        yield message
        for (let i = message.children.length - 1; i >= 0; i--) stack.push(message.children[i]!)
    }
}

function createDay(date: string): MutableUsageDay {
    return {
        date,
        messages: 0,
        prompts: 0,
        assistantMessages: 0,
        otherMessages: 0,
        conversations: new Map(),
    }
}

function createConversation(conversation: UsageConversationInput): MutableUsageConversation {
    return {
        id: conversation.id,
        title: conversation.title,
        messages: 0,
        prompts: 0,
        assistantMessages: 0,
        otherMessages: 0,
    }
}

function createConversationSummary(conversation: UsageConversationInput): MutableConversationSummary {
    return { id: conversation.id, title: conversation.title, messages: 0, roles: new Map(), dates: new Set() }
}

function toConversationSummary(summary: MutableConversationSummary): ConversationSummary {
    return {
        id: summary.id,
        title: summary.title,
        messages: summary.messages,
        roles: [...summary.roles].map(([role, messages]) => ({ role, messages })).sort((a, b) => b.messages - a.messages || a.role.localeCompare(b.role)),
        firstMessageAt: summary.firstTimestamp === undefined ? undefined : new Date(summary.firstTimestamp).toISOString(),
        lastMessageAt: summary.lastTimestamp === undefined ? undefined : new Date(summary.lastTimestamp).toISOString(),
        lifetimeMs: summary.firstTimestamp === undefined || summary.lastTimestamp === undefined ? undefined : summary.lastTimestamp - summary.firstTimestamp,
        activeDays: summary.dates.size,
    }
}

function toUsageDay(day: MutableUsageDay): UsageDay {
    return {
        date: day.date,
        messages: day.messages,
        prompts: day.prompts,
        assistantMessages: day.assistantMessages,
        otherMessages: day.otherMessages,
        activeChats: day.conversations.size,
        conversations: [...day.conversations.values()].sort(
            (a, b) => b.messages - a.messages || b.prompts - a.prompts || a.title.localeCompare(b.title),
        ),
    }
}

function isValidTimestamp(timestamp: number): boolean {
    return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
}
