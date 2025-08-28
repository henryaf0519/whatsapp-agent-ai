import { Controller, Body, Post, Get, Param } from '@nestjs/common';
import { DynamoService } from './dynamo.service';

@Controller('dynamo')
export class DynamoController {
  constructor(private readonly dynamoService: DynamoService) {}

  @Post()
  async createItem(@Body() payload: Record<string, any>) {
    return this.dynamoService.guardarDato(payload);
  }

  @Get('conversations')
  async getConversations() {
    return this.dynamoService.getConversations();
  }

  @Get('messages/:conversationId')
  getMessages(@Param('conversationId') conversationId: string) {
    return this.dynamoService.getMessages(conversationId);
  }

  @Post('control/:conversationId')
  updateChatMode(
    @Param('conversationId') conversationId: string,
    @Body('newMode') newMode: 'IA' | 'humano',
  ) {
    return this.dynamoService.updateChatMode(conversationId, newMode);
  }

  @Post('message')
  handleAgentMessage(@Body() body: { conversationId: string; text: string }) {
    return this.dynamoService.handleAgentMessage(
      body.conversationId,
      body.text,
    );
  }
}
