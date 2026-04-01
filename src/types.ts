export type Chat = {
    id: string;
    title: string;
    createTime: number;
    updateTime: number;
    userInstructions?: string;
    firstMessage: Message;
};

export type Message = {
    id: string;
    role: string;
    body: string;
    weight: number;
    createTime?: number;
    model?: string;
    children: Message[];
    thoughts?: Thought[];
};

export type Thought = {
    summary: string;
    content: string;
    chunks: string[];
};

export type Input = {
    readonly parse: (filename: string) => AsyncGenerator<Chat>;
};

export type Output = {
    readonly write: (chat: Chat) => void;
};
