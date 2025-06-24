// src/whatsapp/whatsapp-webhook.controller.ts
import { Controller, Post, Req, Res, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { OpenaiService } from '../openai/openai.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import chalk from 'chalk';
import { ChatMessage } from '../common/interfaces/chat-message';

interface WhatsAppMessagePayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messages?: Array<{
          from: string;
          id: string;
          text?: { body: string };
        }>;
      };
      field: string;
    }>;
  }>;
}

@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly openAIService: OpenaiService,
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
  ) {}

  private processedMessageIds = new Set<string>();
  private readonly DEDUPE_TTL_MS = 60 * 1000;

  private isDuplicate(eventId: string): boolean {
    if (this.processedMessageIds.has(eventId)) return true;
    this.processedMessageIds.add(eventId);
    setTimeout(
      () => this.processedMessageIds.delete(eventId),
      this.DEDUPE_TTL_MS,
    );
    return false;
  }

  // Mantiene el historial por usuario
  private conversationHistory = new Map<string, ChatMessage[]>();
  private readonly MAX_CHAT_HISTORY_LENGTH = 10;

  private async processIncomingMessage(from: string, textBody: string) {
    console.log(chalk.blue(`[Recibido] ${from}: ${textBody}`));

    // 1) Recuperar y actualizar historial
    const history = this.conversationHistory.get(from) ?? [];
    history.push({ role: 'user', content: textBody });
    if (history.length > this.MAX_CHAT_HISTORY_LENGTH) {
      history.splice(0, history.length - this.MAX_CHAT_HISTORY_LENGTH);
    }

    // 2) Llamar a OpenaiService pasando el historial
    const replyText = await this.openAIService.getAIResponse(textBody, history);

    // 3) Enviar por WhatsApp
    await this.whatsappService.sendMessage(from, replyText);
    console.log(chalk.green(`[Enviado] ${from}: ${replyText}`));

    // 4) Guardar respuesta en el historial
    history.push({ role: 'assistant', content: replyText });
    if (history.length > this.MAX_CHAT_HISTORY_LENGTH) {
      history.splice(0, history.length - this.MAX_CHAT_HISTORY_LENGTH);
    }
    this.conversationHistory.set(from, history);
  }

  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const VERIFY_TOKEN = this.configService.get<string>(
      'WHATSAPP_VERIFY_TOKEN',
    );
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === VERIFY_TOKEN) {
      console.log(chalk.green('Webhook VERIFICADO correctamente.'));
      return res.status(200).send(challenge);
    }
    console.error(chalk.red('Fallo verificación webhook.'));
    return res.status(403).send('Forbidden');
  }

  @Post('webhook')
  async receiveMessage(@Req() req: Request, @Res() res: Response) {
    try {
      const payload: WhatsAppMessagePayload = req.body;
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      if (change?.field === 'messages') {
        const msg = change.value.messages?.[0];
        if (msg && !this.isDuplicate(msg.id)) {
          await this.processIncomingMessage(msg.from, msg.text?.body ?? '');
        }
      }
    } catch (err) {
      console.error(chalk.red('Error procesando webhook:'), err);
    }
    // Siempre responder 200
    return res.status(200).send('EVENT_RECEIVED');
  }
}
