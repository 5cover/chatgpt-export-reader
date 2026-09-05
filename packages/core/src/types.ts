export type Chat = {
  id: string;
  title: string;
  createTime: number;
  updateTime: number;
  projectName?: string;
  messages: Message[];
  isArchived: boolean;
};

export type Message = {
  id: string;
  role: string;
  body: string;
  weight: number;
  createTime?: number;
  model?: string;
  customInstructions?: string;
  children: Message[];
  thoughts?: Thought[];
};

export type Thought = {
  summary: string;
  content: string;
  chunks: string[];
};
