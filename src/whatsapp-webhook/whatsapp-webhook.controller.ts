/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Post,
  Get,
  Req,
  Res,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleDestroy,
} from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AgentOpenIaService } from 'src/agent/agent-open-ia/agent-open-ia.service';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { SocketGateway } from 'src/socket/socket.gateway';
import { TranscriptionService } from '../transcription/transcription.service';

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  text?: { body: string };
  button?: {
    payload: string;
    text: string;
  };
  image?: {
    caption?: string;
    mime_type: string;
    sha256: string;
    id: string;
  };
  audio?: {
    id: string;
    mime_type: string;
  };
  type: string;
}
interface WhatsAppChange {
  value: {
    messaging_product: string;
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: Array<{
      profile: {
        name: string;
      };
      wa_id: string;
    }>;
    messages?: WhatsAppMessage[];
    statuses?: Array<{
      id: string;
      status: string;
      timestamp: string;
      recipient_id: string;
    }>;
  };
  field: string;
}
interface WhatsAppMessagePayload {
  object: string;
  entry: Array<{
    id: string;
    changes: WhatsAppChange[];
  }>;
}

interface ProcessedMessage {
  id: string;
  timestamp: number;
}

interface payLoad {
  type: 'text' | 'button' | 'image' | 'audio' | 'unsupported';
  text?: string;
  action?: string;
  mediaId?: string;
  mimeType?: string;
  url?: string;
}

interface MessageContent {
  type: 'text' | 'button' | 'image' | 'audio' | 'unsupported';
  body?: string;
  payload?: string;
  text?: string;
  url?: string;
  caption?: string;
}

@Controller('whatsapp')
export class WhatsappWebhookController implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappWebhookController.name);
  private processedMessages = new Map<string, ProcessedMessage>();
  private readonly DEDUPE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  private cleanupInterval!: NodeJS.Timeout;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly chatbotService: AgentOpenIaService,
    private readonly configService: ConfigService,
    private readonly dynamoService: DynamoService,
    private readonly socketGateway: SocketGateway,
    private readonly transcriptionService: TranscriptionService,
  ) {
    this.validateConfiguration();
    this.startCleanupInterval();
  }

  private validateConfiguration(): void {
    const verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (!verifyToken) {
      const error =
        'WHATSAPP_VERIFY_TOKEN no está configurada en las variables de entorno';
      this.logger.error(error);
      throw new Error(error);
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupProcessedMessages();
    }, this.CLEANUP_INTERVAL_MS);
  }

  private cleanupProcessedMessages(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [
      messageId,
      processedMessage,
    ] of this.processedMessages.entries()) {
      if (now - processedMessage.timestamp > this.DEDUPE_TTL_MS) {
        this.processedMessages.delete(messageId);
        cleanedCount++;
      }
    }

    // If we still have too many messages, remove the oldest ones
    if (this.processedMessages.size > this.MAX_PROCESSED_MESSAGES) {
      const sortedEntries = Array.from(this.processedMessages.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp,
      );

      const toRemove = sortedEntries.slice(
        0,
        this.processedMessages.size - this.MAX_PROCESSED_MESSAGES,
      );
      toRemove.forEach(([messageId]) => {
        this.processedMessages.delete(messageId);
        cleanedCount++;
      });
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} processed messages`);
    }
  }

  private isDuplicate(messageId: string): boolean {
    const now = Date.now();

    if (this.processedMessages.has(messageId)) {
      this.logger.warn(`Duplicate message detected: ${messageId}`);
      return true;
    }

    this.processedMessages.set(messageId, {
      id: messageId,
      timestamp: now,
    });

    return false;
  }

  private generateThreadId(phoneNumber: string): string {
    // Use phone number as thread ID for conversation continuity
    // Remove any non-numeric characters and ensure consistent format
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    return `whatsapp_${cleanPhone}`;
  }

  private validateWebhookPayload(payload: any): WhatsAppMessagePayload {
    if (!payload || typeof payload !== 'object') {
      throw new HttpException(
        'Invalid webhook payload: payload is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (payload.object !== 'whatsapp_business_account') {
      throw new HttpException(
        'Invalid webhook payload: object must be whatsapp_business_account',
        HttpStatus.BAD_REQUEST,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (!Array.isArray(payload.entry) || payload.entry.length === 0) {
      throw new HttpException(
        'Invalid webhook payload: entry array is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    return payload as WhatsAppMessagePayload;
  }

  private async validateMessage(
    message: WhatsAppMessage,
    businessId: string,
  ): Promise<MessageContent | null> {
    if (!message.from || !message.id) {
      this.logger.warn('Message missing required fields (from or id)', {
        message,
      });
      return Promise.resolve(null);
    }
    this.logger.debug('Validating message', JSON.stringify(message, null, 2));
    if (message.type === 'button' && message.button) {
      this.logger.debug('Message is a button reply', {
        messageId: message.id,
        payload: message.button.payload,
        text: message.button.text,
      });
      return Promise.resolve({
        type: 'button',
        payload: message.button.payload,
        text: message.button.text,
      });
    }
    if (message.type === 'text' && message.text?.body) {
      const textBody = message.text.body;

      if (textBody.trim().length === 0 || textBody.length > 4096) {
        this.logger.warn('Message text invalid (empty or too long)', {
          messageId: message.id,
          length: textBody.length,
        });
        return Promise.resolve({ type: 'unsupported' });
      }

      this.logger.debug('Message is a text message', {
        messageId: message.id,
        body: textBody,
      });
      return Promise.resolve({
        type: 'text',
        body: textBody,
      });
    }
    if (message.type === 'image' && message.image?.id) {
      try {
        const imageUrl = await this.whatsappService.processAndUploadMedia(
          businessId,
          message.image.id,
          message.image.mime_type,
        );
        return Promise.resolve({
          type: 'image',
          text: imageUrl,
          url: imageUrl,
        });
      } catch (error) {
        // Maneja errores si no se puede obtener la URL
        this.logger.error('Failed to get media URL', { error });
        return Promise.resolve({ type: 'unsupported' });
      }
    }
    if (message.type === 'audio' && message.audio?.id) {
      try {
        this.logger.log(`Procesando audio con mediaId: ${message.audio.id}`);
        const { buffer, mimeType } = await this.whatsappService.downloadMedia(
          message.audio.id,
          businessId,
        );
        const fileName = `audio/${message.from}/${message.id}.ogg`;
        const audioUrl = await this.whatsappService.uploadMediaBuffer(
          fileName,
          buffer,
          mimeType,
        );
        this.logger.log(`Audio subido a S3: ${audioUrl}`);
        const transcribedText = await this.transcriptionService.transcribeAudio(
          buffer,
          mimeType,
        );

        this.logger.log(`Texto transcrito: "${transcribedText}"`);
        // Devolvemos un objeto de tipo 'text' con la transcripción
        return Promise.resolve({
          type: 'audio',
          text: transcribedText,
          url: audioUrl,
        });
      } catch (error) {
        this.logger.error(
          'Error al procesar el audio en validateMessage',
          error,
        );
        return Promise.resolve({ type: 'unsupported' });
      }
    }
    this.logger.warn('Unsupported message type', {
      messageId: message.id,
      type: message.type,
    });
    return Promise.resolve({
      type: 'unsupported',
    });
  }

  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response): Response {
    try {
      const VERIFY_TOKEN = this.configService.get<string>(
        'WHATSAPP_VERIFY_TOKEN',
      );
      const mode = req.query['hub.mode'] as string;
      const token = req.query['hub.verify_token'] as string;
      const challenge = req.query['hub.challenge'] as string;

      this.logger.log('Webhook verification attempt', {
        mode,
        token: token ? '***' : 'missing',
      });

      if (!mode || !token || !challenge) {
        this.logger.error(
          'Webhook verification failed: Missing required parameters',
        );
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required verification parameters',
        });
      }

      if (mode !== 'subscribe') {
        this.logger.error('Webhook verification failed: Invalid mode', {
          mode,
        });
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid mode. Expected: subscribe',
        });
      }

      if (token !== VERIFY_TOKEN) {
        this.logger.error('Webhook verification failed: Invalid token');
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Invalid verify token',
        });
      }

      this.logger.log('Webhook verification successful');
      return res.status(200).send(challenge);
    } catch (error) {
      this.logger.error('Unexpected error during webhook verification', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Unexpected error during verification',
      });
    }
  }

  @Post('webhook')
  async receiveMessage(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    const startTime = Date.now();
    let processedMessages = 0;

    try {
      const payload = this.validateWebhookPayload(req.body);

      // Process each entry
      for (const entry of payload.entry) {
        if (!entry.changes || !Array.isArray(entry.changes)) {
          this.logger.warn('Entry missing changes array', {
            entryId: entry.id,
          });
          continue;
        }

        // Process each change
        for (const change of entry.changes) {
          try {
            await this.processChange(change);
            processedMessages++;
          } catch (error) {
            this.logger.error('Error processing change', {
              error: error instanceof Error ? error.message : String(error),
              changeField: change.field,
              entryId: entry.id,
            });
            // Continue processing other changes even if one fails
          }
        }
      }

      const processingTime = Date.now() - startTime;
      return res.status(200).json({
        status: 'success',
        message: 'EVENT_RECEIVED',
        processed: processedMessages,
        processingTimeMs: processingTime,
      });
    } catch (error) {
      const processingTime = Date.now() - startTime;

      if (error instanceof HttpException) {
        this.logger.error('Webhook validation error', {
          error: error.message,
          status: error.getStatus(),
          processingTimeMs: processingTime,
        });
        return res.status(error.getStatus()).json({
          error: error.message,
          status: 'error',
          processingTimeMs: processingTime,
        });
      }

      this.logger.error('Unexpected error processing webhook', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: processingTime,
      });

      return res.status(500).json({
        error: 'Internal server error',
        status: 'error',
        processingTimeMs: processingTime,
      });
    }
  }

  private async processChange(change: WhatsAppChange): Promise<void> {
    if (change.field !== 'messages') {
      return;
    }
    const businessId = change.value.metadata.phone_number_id;
    const contact = change.value.contacts?.[0];
    const contactName = contact?.profile?.name || 'Desconocido';
    const messages = change.value.messages;
    if (!messages || messages.length === 0) {
      return;
    }
    // Process each message
    for (const message of messages) {
      try {
        await this.processMessage(message, businessId, contactName);
      } catch (error) {
        this.logger.error('Error processing individual message', {
          messageId: message.id,
          from: message.from,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing other messages
      }
    }
  }

  private async processMessage(
    message: WhatsAppMessage,
    businessId: string,
    contactName: string,
  ): Promise<void> {
    let payload: payLoad | undefined = undefined;
    if (this.isDuplicate(message.id)) {
      return;
    }
    const messageContent = await this.validateMessage(message, businessId);
    if (!messageContent) {
      return;
    }

    this.logger.log('Processing message', {
      businessId,
      contactName,
    });
    // Validate message
    payload = this.createPayload(messageContent);
    this.logger.debug('Payload:', JSON.stringify(payload, null, 2));

    if (payload && payload.type === 'unsupported') {
      this.logger.warn('Unsupported message type received', {
        messageId: message.id,
        type: message.type,
      });
      return;
    }

    const threadId = this.generateThreadId(message.from);

    try {
      await this.dynamoService.saveMessage(
        businessId,
        message.from,
        message.from,
        payload?.text || '',
        message.id,
        'RECEIVED',
        payload?.type || '',
        payload?.url || '',
      );
      const sendSocketUser = {
        from: message.from,
        text: payload?.text || '',
        type: payload?.type || 'text',
        url: payload?.url || '',
        SK: `MESSAGE#${new Date().toISOString()}`,
      };
      this.socketGateway.sendNewMessageNotification(
        businessId,
        message.from,
        sendSocketUser,
      );
      await this.dynamoService.createOrUpdateChatMode(
        businessId,
        contactName,
        message.from,
        'IA',
      );
      const chatMode = await this.dynamoService.getChatMode(
        businessId,
        message.from,
      );
      this.logger.debug('modo: ', chatMode);
      if (chatMode && chatMode === 'humano') {
        this.logger.log(
          `Chat ${message.from} está en control humano. La IA no responderá.`,
        );
        return;
      }

      const reply = await this.chatbotService.hablar(
        threadId,
        payload as payLoad,
      );
      const messageResp =
        reply.type === 'plantilla'
          ? (reply.template ?? '')
          : (reply.text ?? '');

      await this.dynamoService.saveMessage(
        businessId,
        message.from,
        'IA',
        messageResp,
        message.id,
        'SEND',
        reply.type,
      );
      const sendSocketIA = {
        from: 'IA',
        text: messageResp,
        type: reply.type,
        SK: `MESSAGE#${new Date().toISOString()}`,
      };
      this.socketGateway.sendNewMessageNotification(
        businessId,
        message.from,
        sendSocketIA,
      );

      if (!reply) {
        // Send a default error message
        const defaultReply =
          'Lo siento, no pude procesar tu mensaje en este momento. Por favor, intenta de nuevo.';
        await this.whatsappService.sendMessage(
          message.from,
          businessId,
          defaultReply,
        );
        return;
      }
      if (reply.type === 'plantilla') {
        await this.whatsappService.sendTemplateMessage(
          message.from,
          businessId,
          reply.template || '',
        );
      } else {
        await this.whatsappService.sendMessage(
          message.from,
          businessId,
          reply.text ?? '',
        );
      }
    } catch (error) {
      this.logger.error(
        'Error processing message with chatbot or sending response',
        {
          messageId: message.id,
          threadId,
          from: message.from,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      );

      // Try to send an error message to the user
      try {
        const errorReply =
          'Disculpa, hubo un problema procesando tu mensaje. Nuestro equipo ha sido notificado.';
        await this.whatsappService.sendMessage(
          message.from,
          businessId,
          errorReply,
        );
      } catch (sendError) {
        this.logger.error('Failed to send error message to user', {
          messageId: message.id,
          from: message.from,
          sendError:
            sendError instanceof Error ? sendError.message : String(sendError),
        });
      }
    }
  }

  private createPayload(messageContent: MessageContent): any {
    let payload: any;

    this.logger.debug(
      'messageContent: ',
      JSON.stringify(messageContent, null, 2),
    );

    switch (messageContent.type) {
      case 'button':
        payload = {
          type: 'button',
          action: messageContent.payload,
          text: messageContent.text,
        };
        break;
      case 'text':
        payload = {
          type: 'text',
          text: (messageContent.body ?? '').trim(),
        };
        break;
      case 'image':
        payload = {
          type: 'image',
          text: messageContent.text,
          url: messageContent.text,
        };
        break;
      case 'audio':
        return {
          type: 'audio',
          text: messageContent.text,
          url: messageContent.url,
        };

      case 'unsupported':
      default:
        payload = { type: 'unsupported' };
        break;
    }

    return payload;
  }

  // Cleanup on module destroy
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.processedMessages.clear();
  }
}
