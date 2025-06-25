import { Controller, Post, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import chalk from 'chalk';

import { WhatsappService } from '../whatsapp/whatsapp.service';
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
  private processedMessageIds = new Set<string>();
  private readonly DEDUPE_TTL_MS = 60 * 1000;

  // Guarda el historial por remitente
  private conversationHistory = new Map<string, ChatMessage[]>();
  private readonly MAX_HISTORY = 10;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
  ) {}

  private isDuplicate(id: string): boolean {
    if (this.processedMessageIds.has(id)) return true;
    this.processedMessageIds.add(id);
    setTimeout(() => this.processedMessageIds.delete(id), this.DEDUPE_TTL_MS);
    return false;
  }

  private async processIncomingMessage(from: string, text: string) {
    console.log(chalk.blue(`[Recibido] ${from}: ${text}`));

    // 1) Recupera historial y añade mensaje
    const history = this.conversationHistory.get(from) ?? [];
    history.push({ role: 'user', content: text });
    if (history.length > this.MAX_HISTORY) {
      history.splice(0, history.length - this.MAX_HISTORY);
    }

    // 2) Llama a OpenAIService PASANDOLE el historial completo
    const reply = 'Hola';

    // 3) Envía por WhatsApp sólo el texto resultante
    await this.whatsappService.sendMessage(from, reply);
    console.log(chalk.green(`[Enviado] ${from}: ${reply}`));

    // 4) Guarda la respuesta en el historial
    history.push({ role: 'assistant', content: reply });
    if (history.length > this.MAX_HISTORY) {
      history.splice(0, history.length - this.MAX_HISTORY);
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
      const payload = req.body as WhatsAppMessagePayload;
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];

      if (change?.field === 'messages') {
        const m = change.value.messages?.[0];
        if (m && !this.isDuplicate(m.id)) {
          await this.processIncomingMessage(m.from, m.text?.body ?? '');
        }
      }
    } catch (err) {
      console.error(chalk.red('Error procesando webhook:'), err);
    }
    return res.status(200).send('EVENT_RECEIVED');
  }
}
