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
    createTime: number;
    children: Message[];
};

export type Input = {
    readonly parse: (filename: string) => Chat[];
};

export type Output = {
    readonly write: (chat: Chat) => void;
};
