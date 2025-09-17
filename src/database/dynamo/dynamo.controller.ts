import {
  Controller,
  Body,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  Patch,
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

  @UseGuards(AuthGuard('jwt'))
  @Get('messages/:conversationId')
  getMessages(
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
  ) {
    // Obtenemos el number_id del usuario logueado desde el token
    console.log('Fetching messages for conversationId:', conversationId);
    const user = req.user as { number_id: string } | undefined;
    console.log('Fetching messages for conversationId:', user);
    if (!user || !user.number_id) {
      throw new Error('number_id no encontrado en el token del usuario.');
    }
    const businessId = user.number_id;
    return this.dynamoService.getMessages(businessId, conversationId);
  }

  @Post('control/:conversationId')
  updateChatMode(
    @Param('conversationId') conversationId: string,
    @Body('newMode') newMode: 'IA' | 'humano',
    @Req() req: Request,
  ) {
    const user = req.user as { number_id: string } | undefined;
    if (!user || !user.number_id) {
      throw new Error('numer_id no encontrado en el token del usuario.');
    }
    return this.dynamoService.updateChatMode(
      user.number_id,
      conversationId,
      newMode,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('message')
  handleAgentMessage(
    @Body() body: { conversationId: string; text: string },
    @Req() req: Request,
  ) {
    const user = req.user as { number_id: string } | undefined;
    if (!user || !user.number_id) {
      throw new Error('numer_id no encontrado en el token del usuario.');
    }

    return this.dynamoService.handleAgentMessage(
      user.number_id,
      body.conversationId,
      body.text,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('contacts')
  async getContacts(@Req() req: Request) {
    const user = req.user as { number_id: string } | undefined;
    if (!user || !user.number_id) {
      throw new Error('number_id no encontrado en el token del usuario.');
    }
    return this.dynamoService.getContactsForBusiness(user.number_id);
  }

  @Patch('contacts/:conversationId/stage')
  @UseGuards(AuthGuard('jwt'))
  updateContactStage(
    @Param('conversationId') conversationId: string,
    @Body('stage') stage: string,
    @Req() req: Request,
  ) {
    const user = req.user as { number_id: string } | undefined;
    if (!user || !user.number_id) {
      throw new Error('businessId no encontrado en el token del usuario.');
    }
    return this.dynamoService.updateContactStage(
      user.number_id,
      conversationId,
      stage,
    );
  }
}
