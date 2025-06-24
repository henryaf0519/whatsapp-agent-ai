import { McpConversationService } from './mcp-conversation.service';

describe('McpConversationService', () => {
  it('should store and restore conversations', () => {
    const svc = new McpConversationService();
    svc.appendUserMessage('u', 'hi');
    svc.appendAssistantMessage('u', 'hello');
    const data = svc.serialize('u');
    expect(data).toBeDefined();
    const svc2 = new McpConversationService();
    if (data) {
      svc2.load('u', data);
    }
    const convo = svc2.getConversation('u');
    expect(convo.getMessages().length).toBe(3); // includes system prompt
  });
});
