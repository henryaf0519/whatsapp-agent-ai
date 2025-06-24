export type Role = 'system' | 'user' | 'assistant';

export interface ConversationMessage {
  role: Role;
  content: string;
}

export interface ToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

export interface ParsedToolCall<T> {
  name: string;
  arguments: T;
}

export class Conversation {
  private messages: ConversationMessage[] = [];

  appendSystem(content: string) {
    this.messages.push({ role: 'system', content });
  }

  appendUser(content: string) {
    this.messages.push({ role: 'user', content });
  }

  appendAssistant(content: string) {
    this.messages.push({ role: 'assistant', content });
  }

  getMessages() {
    return this.messages;
  }

  toOpenAIMessages() {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  serialize(): string {
    return JSON.stringify(this.messages);
  }

  static deserialize(data: string): Conversation {
    const c = new Conversation();
    try {
      const msgs: ConversationMessage[] = JSON.parse(data);
      c.messages = msgs;
    } catch {
      // ignore
    }
    return c;
  }
}

export function parseToolCall<T>(call: ToolCall): ParsedToolCall<T> {
  return {
    name: call.function.name,
    arguments: JSON.parse(call.function.arguments || '{}') as T,
  };
}
