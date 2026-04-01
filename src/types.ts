export type Chat = {
    title: string;
    createTime: number;
    updateTime: number;
    userInstructions?: string;
    firstMessage: Message;
};

export type Message = {
    role: string;
    body: string;
    weight: number;
    createTime: number;
    children: Message[];
};

export type InputSchema = {
    parse: (filename: string) => Chat[];
};
