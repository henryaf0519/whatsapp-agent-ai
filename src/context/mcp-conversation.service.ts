import { Injectable } from '@nestjs/common';
import { Conversation } from '@modelcontextprotocol/sdk';
import { systemPrompt } from '../openai/prompts/system-prompt';

@Injectable()
export class McpConversationService {
  private conversations = new Map<string, Conversation>();

  getConversation(id: string): Conversation {
    let convo = this.conversations.get(id);
    if (!convo) {
      convo = new Conversation();
      convo.appendSystem(systemPrompt);
      this.conversations.set(id, convo);
    }
    return convo;
  }

  appendUserMessage(id: string, content: string): void {
    this.getConversation(id).appendUser(content);
  }

  appendAssistantMessage(id: string, content: string): void {
    this.getConversation(id).appendAssistant(content);
  }

  serialize(id: string): string | undefined {
    const convo = this.conversations.get(id);
    return convo?.serialize();
  }

  load(id: string, data: string): void {
    const convo = Conversation.deserialize(data);
    this.conversations.set(id, convo);
  }
}
