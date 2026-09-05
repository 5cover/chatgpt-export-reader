import type { Chat, Message } from "./types.js";

export type UsageStatistics = {
  summary: UsageSummary;
  days: UsageDay[];
  roles: UsageRole[];
  conversations: ConversationSummary[];
};

export type UsageStatsOptions = {
  timeZone?: string;
  startDate?: string;
};

export type UsageSummary = {
  chats: number;
  messages: number;
  timestampedMessages: number;
  untimestampedMessages: number;
  prompts: number;
  assistantMessages: number;
  firstMessageAt?: string;
  lastMessageAt?: string;
  activeDays: number;
};

export type UsageDay = {
  date: string;
  messages: number;
  prompts: number;
  assistantMessages: number;
  otherMessages: number;
  activeChats: number;
  conversations: UsageConversation[];
};

export type UsageConversation = {
  id: string;
  title: string;
  messages: number;
  prompts: number;
  assistantMessages: number;
  otherMessages: number;
};

export type UsageConversationInput = {
  id: string;
  title: string;
  messages: Iterable<UsageMessageInput>;
};

export type UsageMessageInput = {
  role: string;
  createTime?: number;
};

export type UsageRole = {
  role: string;
  messages: number;
};

export type ConversationSummary = {
  id: string;
  title: string;
  messages: number;
  roles: UsageRole[];
  firstMessageAt?: string;
  lastMessageAt?: string;
  lifetimeMs?: number;
  activeDays: number;
};

type MutableUsageConversation = UsageConversation;
type MutableConversationSummary = Omit<
  ConversationSummary,
  "roles" | "firstMessageAt" | "lastMessageAt" | "lifetimeMs" | "activeDays"
> & {
  roles: Map<string, number>;
  dates: Set<string>;
  firstTimestamp?: number;
  lastTimestamp?: number;
};
type MutableUsageDay = Omit<UsageDay, "activeChats" | "conversations"> & {
  conversations: Map<string, MutableUsageConversation>;
};

export class UsageStatsAccumulator {
  private readonly summary: UsageSummary = {
    chats: 0,
    messages: 0,
    timestampedMessages: 0,
    untimestampedMessages: 0,
    prompts: 0,
    assistantMessages: 0,
    activeDays: 0,
  };
  private readonly days = new Map<string, MutableUsageDay>();
  private readonly roles = new Map<string, number>();
  private readonly conversations = new Map<
    string,
    MutableConversationSummary
  >();
  private firstTimestamp: number | undefined;
  private lastTimestamp: number | undefined;
  private readonly dayFormatter: Intl.DateTimeFormat;
  private readonly startDate: string | undefined;

  constructor(options: string | UsageStatsOptions = "UTC") {
    const { timeZone = "UTC", startDate } =
      typeof options === "string" ? { timeZone: options } : options;
    this.dayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    this.startDate =
      startDate === undefined ? undefined : validateStartDate(startDate);
  }

  addChat(chat: Chat): void {
    this.addConversation({
      id: chat.id,
      title: chat.title,
      messages: walkMessages(chat.messages),
    });
  }

  addConversation(conversation: UsageConversationInput): void {
    let summary = this.conversations.get(conversation.id);
    let includedConversation = false;

    if (this.startDate === undefined) {
      this.summary.chats++;
      summary ??= createConversationSummary(conversation);
      this.conversations.set(conversation.id, summary);
      includedConversation = true;
    }

    for (const message of conversation.messages) {
      if (!this.shouldInclude(message)) continue;
      if (!includedConversation) {
        this.summary.chats++;
        summary ??= createConversationSummary(conversation);
        this.conversations.set(conversation.id, summary);
        includedConversation = true;
      }
      this.addMessage(conversation, message, summary!);
    }
  }

  private shouldInclude(message: UsageMessageInput): boolean {
    if (this.startDate === undefined) return true;
    const timestamp = message.createTime;
    return (
      timestamp !== undefined &&
      isValidTimestamp(timestamp) &&
      this.dayKey(timestamp) >= this.startDate
    );
  }

  finish(): UsageStatistics {
    const days = this.fillDays();
    return {
      summary: {
        ...this.summary,
        firstMessageAt:
          this.firstTimestamp === undefined
            ? undefined
            : new Date(this.firstTimestamp).toISOString(),
        lastMessageAt:
          this.lastTimestamp === undefined
            ? undefined
            : new Date(this.lastTimestamp).toISOString(),
        activeDays: days.filter((day) => day.messages > 0).length,
      },
      days,
      roles: [...this.roles]
        .map(([role, messages]) => ({ role, messages }))
        .sort(
          (a, b) => b.messages - a.messages || a.role.localeCompare(b.role),
        ),
      conversations: [...this.conversations.values()]
        .map(toConversationSummary)
        .sort(
          (a, b) => b.messages - a.messages || a.title.localeCompare(b.title),
        ),
    };
  }

  private addMessage(
    conversation: UsageConversationInput,
    message: UsageMessageInput,
    summary: MutableConversationSummary,
  ): void {
    this.summary.messages++;
    summary.messages++;
    summary.roles.set(message.role, (summary.roles.get(message.role) ?? 0) + 1);
    this.roles.set(message.role, (this.roles.get(message.role) ?? 0) + 1);
    if (message.role === "user") this.summary.prompts++;
    if (message.role === "assistant") this.summary.assistantMessages++;

    const timestamp = message.createTime;
    if (timestamp === undefined || !isValidTimestamp(timestamp)) {
      this.summary.untimestampedMessages++;
      return;
    }

    this.summary.timestampedMessages++;
    summary.firstTimestamp =
      summary.firstTimestamp === undefined
        ? timestamp
        : Math.min(summary.firstTimestamp, timestamp);
    summary.lastTimestamp =
      summary.lastTimestamp === undefined
        ? timestamp
        : Math.max(summary.lastTimestamp, timestamp);
    this.firstTimestamp =
      this.firstTimestamp === undefined
        ? timestamp
        : Math.min(this.firstTimestamp, timestamp);
    this.lastTimestamp =
      this.lastTimestamp === undefined
        ? timestamp
        : Math.max(this.lastTimestamp, timestamp);

    const date = this.dayKey(timestamp);
    summary.dates.add(date);
    const day = this.days.get(date) ?? createDay(date);
    this.days.set(date, day);
    day.messages++;
    if (message.role === "user") day.prompts++;
    else if (message.role === "assistant") day.assistantMessages++;
    else day.otherMessages++;

    const dayConversation =
      day.conversations.get(conversation.id) ??
      createConversation(conversation);
    day.conversations.set(conversation.id, dayConversation);
    dayConversation.messages++;
    if (message.role === "user") dayConversation.prompts++;
    else if (message.role === "assistant") dayConversation.assistantMessages++;
    else dayConversation.otherMessages++;
  }

  private fillDays(): UsageDay[] {
    if (this.firstTimestamp === undefined || this.lastTimestamp === undefined)
      return [];

    const days: UsageDay[] = [];
    const current = new Date(this.firstTimestamp);
    current.setUTCHours(12, 0, 0, 0);
    const endDate = this.dayKey(this.lastTimestamp);

    while (true) {
      const date = this.dayKey(current.getTime());
      const day = this.days.get(date) ?? createDay(date);
      days.push(toUsageDay(day));
      if (date === endDate) return days;
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  private dayKey(timestamp: number): string {
    const parts = this.dayFormatter.formatToParts(timestamp);
    const value = new Map(parts.map((part) => [part.type, part.value]));
    return `${value.get("year")!}-${value.get("month")!}-${value.get("day")!}`;
  }
}

export async function collectUsageStatistics(
  chats: AsyncIterable<Chat>,
  options: string | UsageStatsOptions = "UTC",
): Promise<UsageStatistics> {
  const accumulator = new UsageStatsAccumulator(options);
  for await (const chat of chats) accumulator.addChat(chat);
  return accumulator.finish();
}

function* walkMessages(roots: readonly Message[]): Generator<Message> {
  const seen = new Set<Message>();
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const message = stack.pop()!;
    if (seen.has(message)) continue;
    seen.add(message);
    yield message;
    for (let i = message.children.length - 1; i >= 0; i--)
      stack.push(message.children[i]!);
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
  };
}

function createConversation(
  conversation: UsageConversationInput,
): MutableUsageConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    messages: 0,
    prompts: 0,
    assistantMessages: 0,
    otherMessages: 0,
  };
}

function createConversationSummary(
  conversation: UsageConversationInput,
): MutableConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    messages: 0,
    roles: new Map(),
    dates: new Set(),
  };
}

function toConversationSummary(
  summary: MutableConversationSummary,
): ConversationSummary {
  return {
    id: summary.id,
    title: summary.title,
    messages: summary.messages,
    roles: [...summary.roles]
      .map(([role, messages]) => ({ role, messages }))
      .sort((a, b) => b.messages - a.messages || a.role.localeCompare(b.role)),
    firstMessageAt:
      summary.firstTimestamp === undefined
        ? undefined
        : new Date(summary.firstTimestamp).toISOString(),
    lastMessageAt:
      summary.lastTimestamp === undefined
        ? undefined
        : new Date(summary.lastTimestamp).toISOString(),
    lifetimeMs:
      summary.firstTimestamp === undefined ||
      summary.lastTimestamp === undefined
        ? undefined
        : summary.lastTimestamp - summary.firstTimestamp,
    activeDays: summary.dates.size,
  };
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
      (a, b) =>
        b.messages - a.messages ||
        b.prompts - a.prompts ||
        a.title.localeCompare(b.title),
    ),
  };
}

function isValidTimestamp(timestamp: number): boolean {
  return (
    Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
  );
}

function validateStartDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null)
    throw new RangeError(`Invalid start date: ${value}. Expected YYYY-MM-DD.`);

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(
      `Invalid start date: ${value}. Expected a real calendar date.`,
    );
  }
  return value;
}
