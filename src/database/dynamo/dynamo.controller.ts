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
  async getMessages(@Param('conversationId') conversationId: string) {
    return this.dynamoService.getMessages(conversationId);
  }
}
