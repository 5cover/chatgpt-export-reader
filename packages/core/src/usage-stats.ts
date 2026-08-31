import type { Chat, Message } from './types.js'

export type UsageStatistics = {
    summary: UsageSummary
    days: UsageDay[]
    roles: UsageRole[]
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

export type UsageRole = {
    role: string
    messages: number
}

type MutableUsageConversation = UsageConversation
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
        this.summary.chats++
        for (const message of walkMessages(chat.messages)) this.addMessage(chat, message)
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
        }
    }

    private addMessage(chat: Chat, message: Message): void {
        this.summary.messages++
        this.roles.set(message.role, (this.roles.get(message.role) ?? 0) + 1)
        if (message.role === 'user') this.summary.prompts++
        if (message.role === 'assistant') this.summary.assistantMessages++

        const timestamp = message.createTime
        if (timestamp === undefined || !isValidTimestamp(timestamp)) {
            this.summary.untimestampedMessages++
            return
        }

        this.summary.timestampedMessages++
        this.firstTimestamp = this.firstTimestamp === undefined ? timestamp : Math.min(this.firstTimestamp, timestamp)
        this.lastTimestamp = this.lastTimestamp === undefined ? timestamp : Math.max(this.lastTimestamp, timestamp)

        const date = this.dayKey(timestamp)
        const day = this.days.get(date) ?? createDay(date)
        this.days.set(date, day)
        day.messages++
        if (message.role === 'user') day.prompts++
        else if (message.role === 'assistant') day.assistantMessages++
        else day.otherMessages++

        const conversation = day.conversations.get(chat.id) ?? createConversation(chat)
        day.conversations.set(chat.id, conversation)
        conversation.messages++
        if (message.role === 'user') conversation.prompts++
        else if (message.role === 'assistant') conversation.assistantMessages++
        else conversation.otherMessages++
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

function createConversation(chat: Chat): MutableUsageConversation {
    return {
        id: chat.id,
        title: chat.title,
        messages: 0,
        prompts: 0,
        assistantMessages: 0,
        otherMessages: 0,
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
