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
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
          conversation?: any;
          pricing?: {
            billable: boolean;
            pricing_model: string;
            category: string;
          };
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
        metadata?: { display_phone_number: string; phone_number_id: string };
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

  private conversationHistory = new Map<string, ChatMessage[]>();
  private readonly MAX_CHAT_HISTORY_LENGTH = 10;

  private async processIncomingMessage(
    from: string,
    textBody: string,
  ): Promise<void> {
    console.log(chalk.blue(`[Recibido] Mensaje de ${from}: ${textBody}`));

    // Guarda en el historial (opcional)
    const history = this.conversationHistory.get(from) || [];
    history.push({ role: 'user', content: textBody });

    // Aquí solo llamamos a MCP → OpenAI → Tool y recibimos texto listo
    const replyText = await this.openAIService.getAIResponse(textBody);

    // Enviamos la respuesta
    await this.whatsappService.sendMessage(from, replyText);
    console.log(chalk.green(`[Enviado] Respuesta a ${from}: ${replyText}`));

    // Actualiza historial
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
      res.status(200).send(challenge);
    } else {
      console.error(chalk.red('Fallo en la verificación del webhook.'));
      res.status(403).send('Forbidden');
    }
  }

  @Post('webhook')
  async receiveMessage(@Req() req: Request, @Res() res: Response) {
    try {
      const messageData: WhatsAppMessagePayload = req.body;
      const entry = messageData.entry?.[0];
      const change = entry?.changes?.[0];
      if (!entry || !change) return res.status(200).send('EVENT_RECEIVED');

      if (change.field === 'messages') {
        const messages = change.value?.messages;
        if (messages && messages.length > 0) {
          const { id, from, text } = messages[0];
          if (!from || !text?.body)
            return res.status(200).send('EVENT_RECEIVED');
          if (!this.isDuplicate(id)) {
            await this.processIncomingMessage(from, text.body);
          }
        }
      }
      // Siempre devolvemos 200 para WhatsApp
      return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error(chalk.red('Error procesando el webhook:'), error);
      return res.status(200).send('EVENT_RECEIVED');
    }
  }
}
