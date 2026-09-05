import type { Chat, Message } from "./types.js";

export type TextMetrics = {
  characters: number;
  words: number;
};

export type AnalyticsOptions = {
  timeZone?: string;
  startDate?: string;
  sessionGapMinutes?: number;
};

export type AnalyticsSummary = {
  chats: number;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
  other: TextMetrics;
  sessions: number;
  activeDays: number;
  firstMessageAt?: string;
  lastMessageAt?: string;
};

export type AnalyticsDay = {
  date: string;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
  other: TextMetrics;
  activeChats: number;
  sessionsStarted: number;
  conversations: DayConversation[];
};

export type DayConversation = {
  id: string;
  title: string;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
};

export type TemporalCell = {
  weekday: number;
  hour: number;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
  sessionsStarted: number;
};

export type ConversationAnalytics = {
  id: string;
  title: string;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
  other: TextMetrics;
  sessions: number;
  activeDays: number;
  firstMessageAt?: string;
  lastMessageAt?: string;
  lifetimeMs?: number;
};

export type SessionAnalytics = {
  id: string;
  startAt: string;
  endAt: string;
  spanMs: number;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
  conversations: readonly { id: string; title: string }[];
  preview?: string;
};

export type AnalyticsStatistics = {
  summary: AnalyticsSummary;
  days: AnalyticsDay[];
  hours: TemporalCell[];
  conversations: ConversationAnalytics[];
  sessions: SessionAnalytics[];
};

export type TurnBin = {
  startIndex: number;
  endIndex: number;
  messages: number;
  prompts: number;
  input: TextMetrics;
  output: TextMetrics;
  startAt?: string;
  endAt?: string;
};

export type TurnOutline = {
  id: string;
  index: number;
  role: string;
  createTime?: string;
  input: TextMetrics;
  output: TextMetrics;
  preview: string;
  session: number;
};

export type ConversationDetail = {
  summary: ConversationAnalytics;
  sessions: SessionAnalytics[];
  turnBins: TurnBin[];
  totalTurns: number;
};

export type TurnPage = {
  offset: number;
  total: number;
  turns: TurnOutline[];
};

export type MessageContent = {
  id: string;
  body: string;
};

export type RepeatedPhrase = {
  phrase: string;
  occurrences: number;
  words: number;
  score: number;
};

export type RepeatedPhraseAnalysis = {
  user: RepeatedPhrase[];
  assistant: RepeatedPhrase[];
};

type Event = {
  id: string;
  order: number;
  chatId: string;
  title: string;
  role: string;
  body: string;
  createTime?: number;
  input: TextMetrics;
  output: TextMetrics;
  other: TextMetrics;
  session?: number;
};

type MutableTextMetrics = TextMetrics;
type MutableDay = Omit<AnalyticsDay, "activeChats" | "conversations"> & {
  conversations: Map<string, DayConversation>;
};
type MutableConversation = Omit<
  ConversationAnalytics,
  "sessions" | "activeDays" | "firstMessageAt" | "lastMessageAt" | "lifetimeMs"
> & {
  sessionIds: Set<number>;
  dates: Set<string>;
  first?: number;
  last?: number;
};

const textMetricCache = new WeakMap<Message, TextMetrics>();

export function collectAnalytics(
  chats: Iterable<Chat>,
  options: AnalyticsOptions = {},
): AnalyticsStatistics {
  const context = createContext(options);
  const events = collectEvents(chats, context);
  return aggregate(events, context);
}

export function collectConversationDetail(
  chats: Iterable<Chat>,
  options: AnalyticsOptions = {},
): ConversationDetail | undefined {
  const context = createContext(options);
  const events = collectEvents(chats, context);
  const statistics = aggregate(events, context);
  const summary = statistics.conversations[0];
  if (summary === undefined) return undefined;
  const sorted = sortEvents(events);
  const sessions = statistics.sessions;
  return {
    summary,
    sessions,
    turnBins: createTurnBins(sorted),
    totalTurns: sorted.length,
  };
}

export function findConversationTurns(
  chats: Iterable<Chat>,
  options: AnalyticsOptions = {},
  offset = 0,
  limit = 50,
  query?: string,
): TurnPage {
  const context = createContext(options);
  const normalizedQuery = query?.trim().toLocaleLowerCase();
  const events = sortEvents(collectEvents(chats, context));
  assignSessions(events, context.sessionGapMs);
  const matching = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        normalizedQuery === undefined ||
        event.body.toLocaleLowerCase().includes(normalizedQuery),
    );
  return {
    offset,
    total: matching.length,
    turns: matching
      .slice(offset, offset + limit)
      .map(({ event, index }) => toOutline(event, index)),
  };
}

export function getMessageContents(
  chats: Iterable<Chat>,
  options: AnalyticsOptions = {},
  ids: readonly string[],
): MessageContent[] {
  const wanted = new Set(ids);
  if (wanted.size === 0) return [];
  const context = createContext(options);
  return collectEvents(chats, context)
    .filter((event) => wanted.has(event.id))
    .map((event) => ({ id: event.id, body: event.body }));
}

export function collectRepeatedPhrases(
  chats: Iterable<Chat>,
  options: AnalyticsOptions = {},
): RepeatedPhraseAnalysis {
  const context = createContext(options);
  const events = sortEvents(collectEvents(chats, context));
  return {
    user: collectRolePhrases(events, "user", context.segmenter),
    assistant: collectRolePhrases(events, "assistant", context.segmenter),
  };
}

function aggregate(events: Event[], context: Context): AnalyticsStatistics {
  const summary: AnalyticsSummary = {
    chats: 0,
    messages: 0,
    prompts: 0,
    input: emptyText(),
    output: emptyText(),
    other: emptyText(),
    sessions: 0,
    activeDays: 0,
  };
  const days = new Map<string, MutableDay>();
  const conversations = new Map<string, MutableConversation>();
  const hours = createHours();
  const sorted = sortEvents(events);
  const sessions = assignSessions(sorted, context.sessionGapMs);

  for (const event of sorted) {
    summary.messages++;
    addText(summary.input, event.input);
    addText(summary.output, event.output);
    addText(summary.other, event.other);
    if (event.role === "user") summary.prompts++;

    const conversation =
      conversations.get(event.chatId) ?? createConversation(event);
    conversations.set(event.chatId, conversation);
    conversation.messages++;
    if (event.role === "user") conversation.prompts++;
    addText(conversation.input, event.input);
    addText(conversation.output, event.output);
    addText(conversation.other, event.other);

    if (event.createTime === undefined) continue;
    conversation.first =
      conversation.first === undefined
        ? event.createTime
        : Math.min(conversation.first, event.createTime);
    conversation.last =
      conversation.last === undefined
        ? event.createTime
        : Math.max(conversation.last, event.createTime);
    const date = context.dayKey(event.createTime);
    conversation.dates.add(date);
    const day = days.get(date) ?? createDay(date);
    days.set(date, day);
    day.messages++;
    if (event.role === "user") day.prompts++;
    addText(day.input, event.input);
    addText(day.output, event.output);
    addText(day.other, event.other);
    const dayConversation =
      day.conversations.get(event.chatId) ?? createDayConversation(event);
    day.conversations.set(event.chatId, dayConversation);
    dayConversation.messages++;
    if (event.role === "user") dayConversation.prompts++;
    addText(dayConversation.input, event.input);
    addText(dayConversation.output, event.output);

    const { weekday, hour } = context.timeParts(event.createTime);
    const cell = hours[weekday * 24 + hour]!;
    cell.messages++;
    if (event.role === "user") cell.prompts++;
    addText(cell.input, event.input);
    addText(cell.output, event.output);
  }

  for (const session of sessions) {
    const start = Date.parse(session.startAt);
    const day =
      days.get(context.dayKey(start)) ?? createDay(context.dayKey(start));
    days.set(day.date, day);
    day.sessionsStarted++;
    const { weekday, hour } = context.timeParts(start);
    hours[weekday * 24 + hour]!.sessionsStarted++;
    for (const conversation of session.conversations)
      conversations.get(conversation.id)?.sessionIds.add(Number(session.id));
  }

  const filledDays = fillDays(days, context);
  summary.chats = conversations.size;
  summary.sessions = sessions.length;
  summary.activeDays = filledDays.filter((day) => day.messages > 0).length;
  const timestamped = sorted.filter((event) => event.createTime !== undefined);
  summary.firstMessageAt =
    timestamped[0]?.createTime === undefined
      ? undefined
      : new Date(timestamped[0].createTime).toISOString();
  const last = timestamped.at(-1);
  summary.lastMessageAt =
    last?.createTime === undefined
      ? undefined
      : new Date(last.createTime).toISOString();

  return {
    summary,
    days: filledDays,
    hours,
    conversations: [...conversations.values()]
      .map(toConversation)
      .sort(
        (a, b) =>
          b.output.words - a.output.words ||
          b.messages - a.messages ||
          a.title.localeCompare(b.title),
      ),
    sessions,
  };
}

function collectEvents(chats: Iterable<Chat>, context: Context): Event[] {
  const events: Event[] = [];
  let sequence = 0;
  for (const chat of chats) {
    for (const message of walkMessages(chat.messages)) {
      if (!includeMessage(message, context)) continue;
      const metrics = messageTextMetrics(message, context.segmenter);
      events.push({
        id: `${chat.id}:${message.id}:${sequence++}`,
        order: sequence,
        chatId: chat.id,
        title: chat.title,
        role: message.role,
        body: message.body,
        createTime: message.createTime,
        input: message.role === "user" ? metrics : emptyText(),
        output: message.role === "assistant" ? metrics : emptyText(),
        other:
          message.role !== "user" && message.role !== "assistant"
            ? metrics
            : emptyText(),
      });
    }
  }
  return events;
}

type SuffixState = {
  next: Map<number, number>;
  link: number;
  length: number;
  occurrences: number;
  end: number;
};

function collectRolePhrases(
  events: readonly Event[],
  role: "user" | "assistant",
  segmenter: Intl.Segmenter,
): RepeatedPhrase[] {
  const tokenIds = new Map<string, number>();
  const words: string[] = [];
  const states: SuffixState[] = [
    { next: new Map(), link: -1, length: 0, occurrences: 0, end: -1 },
  ];

  for (const event of events) {
    if (event.role !== role) continue;
    let last = 0;
    for (const segment of segmenter.segment(event.body)) {
      if (!segment.isWordLike) continue;
      const normalized = segment.segment.toLocaleLowerCase();
      const token = tokenIds.get(normalized) ?? tokenIds.size;
      tokenIds.set(normalized, token);
      words.push(segment.segment);
      last = appendSuffixToken(states, last, token, words.length - 1);
    }
  }

  const order = states
    .map((_, index) => index)
    .sort((left, right) => states[right]!.length - states[left]!.length);
  for (const index of order) {
    const state = states[index]!;
    if (state.link >= 0) states[state.link]!.occurrences += state.occurrences;
  }

  const phrases = new Map<string, RepeatedPhrase>();
  for (const state of states) {
    if (
      state.length < 2 ||
      state.occurrences < 2 ||
      state.end < state.length - 1
    )
      continue;
    const phrase = words
      .slice(state.end - state.length + 1, state.end + 1)
      .join(" ");
    const current = phrases.get(phrase);
    const candidate = {
      phrase,
      occurrences: state.occurrences,
      words: state.length,
      score: state.occurrences * state.length,
    };
    if (current === undefined || candidate.score > current.score)
      phrases.set(phrase, candidate);
  }
  const ordered = [...phrases.values()].sort(
    (left, right) =>
      right.score - left.score ||
      right.occurrences - left.occurrences ||
      right.words - left.words ||
      left.phrase.localeCompare(right.phrase),
  );
  const maximal: RepeatedPhrase[] = [];
  for (const candidate of ordered) {
    if (
      maximal.some(
        (phrase) =>
          phrase.occurrences === candidate.occurrences &&
          containsPhrase(phrase.phrase, candidate.phrase),
      )
    )
      continue;
    maximal.push(candidate);
    if (maximal.length === 500) break;
  }
  return maximal;
}

function appendSuffixToken(
  states: SuffixState[],
  last: number,
  token: number,
  end: number,
): number {
  const current = states.length;
  states.push({
    next: new Map(),
    link: 0,
    length: states[last]!.length + 1,
    occurrences: 1,
    end,
  });
  let parent = last;
  while (parent >= 0 && !states[parent]!.next.has(token)) {
    states[parent]!.next.set(token, current);
    parent = states[parent]!.link;
  }
  if (parent < 0) return current;
  const existing = states[parent]!.next.get(token)!;
  if (states[parent]!.length + 1 === states[existing]!.length) {
    states[current]!.link = existing;
    return current;
  }
  const clone = states.length;
  states.push({
    next: new Map(states[existing]!.next),
    link: states[existing]!.link,
    length: states[parent]!.length + 1,
    occurrences: 0,
    end: states[existing]!.end,
  });
  while (parent >= 0 && states[parent]!.next.get(token) === existing) {
    states[parent]!.next.set(token, clone);
    parent = states[parent]!.link;
  }
  states[existing]!.link = clone;
  states[current]!.link = clone;
  return current;
}

function containsPhrase(container: string, contained: string): boolean {
  return ` ${container.toLocaleLowerCase()} `.includes(
    ` ${contained.toLocaleLowerCase()} `,
  );
}

function includeMessage(message: Message, context: Context): boolean {
  if (context.startDate === undefined) return true;
  return (
    message.createTime !== undefined &&
    context.dayKey(message.createTime) >= context.startDate
  );
}

function sortEvents(events: readonly Event[]): Event[] {
  return [...events].sort(
    (a, b) =>
      (a.createTime ?? Number.POSITIVE_INFINITY) -
        (b.createTime ?? Number.POSITIVE_INFINITY) || a.order - b.order,
  );
}

function assignSessions(events: Event[], gapMs: number): SessionAnalytics[] {
  const sessions: MutableSession[] = [];
  let current: MutableSession | undefined;
  let previousTime: number | undefined;
  for (const event of events) {
    if (event.createTime === undefined) continue;
    if (
      current === undefined ||
      previousTime === undefined ||
      event.createTime - previousTime > gapMs
    ) {
      current = createSession(sessions.length + 1, event.createTime);
      sessions.push(current);
    }
    event.session = Number(current.id);
    current.end = event.createTime;
    current.messages++;
    if (event.role === "user") current.prompts++;
    addText(current.input, event.input);
    addText(current.output, event.output);
    current.conversations.set(event.chatId, {
      id: event.chatId,
      title: event.title,
    });
    if (current.preview === undefined && event.role === "user")
      current.preview = preview(event.body);
    previousTime = event.createTime;
  }
  return sessions.map((session) => ({
    id: session.id,
    startAt: new Date(session.start).toISOString(),
    endAt: new Date(session.end).toISOString(),
    spanMs: session.end - session.start,
    messages: session.messages,
    prompts: session.prompts,
    input: session.input,
    output: session.output,
    conversations: [...session.conversations.values()],
    preview: session.preview,
  }));
}

type MutableSession = Omit<
  SessionAnalytics,
  "startAt" | "endAt" | "spanMs" | "conversations"
> & {
  start: number;
  end: number;
  conversations: Map<string, { id: string; title: string }>;
};
function createSession(index: number, start: number): MutableSession {
  return {
    id: String(index),
    start,
    end: start,
    messages: 0,
    prompts: 0,
    input: emptyText(),
    output: emptyText(),
    conversations: new Map(),
  };
}

function createTurnBins(events: readonly Event[]): TurnBin[] {
  const width = Math.max(1, Math.ceil(events.length / 200));
  const bins: TurnBin[] = [];
  for (let start = 0; start < events.length; start += width) {
    const chunk = events.slice(start, start + width);
    const first = chunk[0]!;
    const last = chunk.at(-1)!;
    const bin: TurnBin = {
      startIndex: start + 1,
      endIndex: start + chunk.length,
      messages: 0,
      prompts: 0,
      input: emptyText(),
      output: emptyText(),
    };
    for (const event of chunk) {
      bin.messages++;
      if (event.role === "user") bin.prompts++;
      addText(bin.input, event.input);
      addText(bin.output, event.output);
    }
    bin.startAt =
      first.createTime === undefined
        ? undefined
        : new Date(first.createTime).toISOString();
    bin.endAt =
      last.createTime === undefined
        ? undefined
        : new Date(last.createTime).toISOString();
    bins.push(bin);
  }
  return bins;
}

function toOutline(event: Event, index: number): TurnOutline {
  return {
    id: event.id,
    index: index + 1,
    role: event.role,
    createTime:
      event.createTime === undefined
        ? undefined
        : new Date(event.createTime).toISOString(),
    input: event.input,
    output: event.output,
    preview: preview(event.body),
    session: event.session ?? 0,
  };
}

function createContext(options: AnalyticsOptions): Context {
  const timeZone = options.timeZone ?? "UTC";
  const startDate =
    options.startDate === undefined
      ? undefined
      : validateStartDate(options.startDate);
  const sessionGapMinutes = options.sessionGapMinutes ?? 60;
  if (
    !Number.isFinite(sessionGapMinutes) ||
    sessionGapMinutes < 1 ||
    sessionGapMinutes > 1_440
  )
    throw new RangeError("sessionGapMinutes must be between 1 and 1440.");
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return {
    startDate,
    sessionGapMs: sessionGapMinutes * 60_000,
    segmenter,
    dayKey(timestamp) {
      const parts = new Map(
        dayFormatter
          .formatToParts(timestamp)
          .map((part) => [part.type, part.value]),
      );
      return `${parts.get("year")!}-${parts.get("month")!}-${parts.get("day")!}`;
    },
    timeParts(timestamp) {
      const parts = new Map(
        timeFormatter
          .formatToParts(timestamp)
          .map((part) => [part.type, part.value]),
      );
      return {
        weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
          parts.get("weekday")!,
        ),
        hour: Number(parts.get("hour")),
      };
    },
  };
}

type Context = {
  startDate?: string;
  sessionGapMs: number;
  segmenter: Intl.Segmenter;
  dayKey: (timestamp: number) => string;
  timeParts: (timestamp: number) => { weekday: number; hour: number };
};

function createDay(date: string): MutableDay {
  return {
    date,
    messages: 0,
    prompts: 0,
    input: emptyText(),
    output: emptyText(),
    other: emptyText(),
    sessionsStarted: 0,
    conversations: new Map(),
  };
}
function createDayConversation(event: Event): DayConversation {
  return {
    id: event.chatId,
    title: event.title,
    messages: 0,
    prompts: 0,
    input: emptyText(),
    output: emptyText(),
  };
}
function createConversation(event: Event): MutableConversation {
  return {
    id: event.chatId,
    title: event.title,
    messages: 0,
    prompts: 0,
    input: emptyText(),
    output: emptyText(),
    other: emptyText(),
    sessionIds: new Set(),
    dates: new Set(),
  };
}
function createHours(): TemporalCell[] {
  return Array.from({ length: 7 * 24 }, (_, index) => ({
    weekday: Math.floor(index / 24),
    hour: index % 24,
    messages: 0,
    prompts: 0,
    input: emptyText(),
    output: emptyText(),
    sessionsStarted: 0,
  }));
}
function emptyText(): MutableTextMetrics {
  return { characters: 0, words: 0 };
}
function addText(target: MutableTextMetrics, value: TextMetrics): void {
  target.characters += value.characters;
  target.words += value.words;
}
function textMetrics(body: string, segmenter: Intl.Segmenter): TextMetrics {
  return { characters: body.length, words: wordCount(body, segmenter) };
}
function messageTextMetrics(
  message: Message,
  segmenter: Intl.Segmenter,
): TextMetrics {
  const cached = textMetricCache.get(message);
  if (cached !== undefined) return cached;
  const metrics = textMetrics(message.body, segmenter);
  textMetricCache.set(message, metrics);
  return metrics;
}
function wordCount(body: string, segmenter: Intl.Segmenter): number {
  let words = 0;
  for (const segment of segmenter.segment(body))
    if (segment.isWordLike) words++;
  return words;
}
function preview(body: string): string {
  const flat = body.replaceAll(/\s+/g, " ").trim();
  return flat.length <= 180 ? flat : `${flat.slice(0, 177)}...`;
}
function toConversation(value: MutableConversation): ConversationAnalytics {
  return {
    id: value.id,
    title: value.title,
    messages: value.messages,
    prompts: value.prompts,
    input: value.input,
    output: value.output,
    other: value.other,
    sessions: value.sessionIds.size,
    activeDays: value.dates.size,
    firstMessageAt:
      value.first === undefined
        ? undefined
        : new Date(value.first).toISOString(),
    lastMessageAt:
      value.last === undefined ? undefined : new Date(value.last).toISOString(),
    lifetimeMs:
      value.first === undefined || value.last === undefined
        ? undefined
        : value.last - value.first,
  };
}
function fillDays(
  days: ReadonlyMap<string, MutableDay>,
  context: Context,
): AnalyticsDay[] {
  const present = [...days.keys()].sort();
  if (present.length === 0) return [];
  const result: AnalyticsDay[] = [];
  let current = new Date(`${present[0]}T12:00:00Z`);
  const end = present.at(-1)!;
  while (true) {
    const date = context.dayKey(current.getTime());
    const day = days.get(date) ?? createDay(date);
    result.push({
      ...day,
      activeChats: day.conversations.size,
      conversations: [...day.conversations.values()].sort(
        (a, b) => b.messages - a.messages,
      ),
    });
    if (date === end) return result;
    current.setUTCDate(current.getUTCDate() + 1);
  }
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
  )
    throw new RangeError(
      `Invalid start date: ${value}. Expected a real calendar date.`,
    );
  return value;
}
