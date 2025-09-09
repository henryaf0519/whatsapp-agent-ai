import {
  Controller,
  Body,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DynamoService } from './dynamo.service';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

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

  @UseGuards(AuthGuard('jwt'))
  @Get('contacts')
  async getContacts(@Req() req: Request) {
    const user = req.user as { waba_id: string };
    if (!user || !user.waba_id) {
      throw new Error('waba_id no encontrado en el token del usuario.');
    }
    return this.dynamoService.getContactsForBusiness(user.waba_id);
  }
}
