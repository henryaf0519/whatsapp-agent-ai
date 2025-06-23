import { Controller, Post, Body, Req, Res, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { OpenaiService } from '../openai/openai.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { CalendarService } from '../calendar/calendar.service';
import chalk from 'chalk';
import { ChatMessage } from '../common/interfaces/chat-message';

// Interfaz para el payload del webhook de WhatsApp (tu definición existente)
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
          text?: {
            body: string;
          };
        }>;
        metadata?: {
          display_phone_number: string;
          phone_number_id: string;
        };
      };
      field: string;
    }>;
  }>;
}

// INTERFACES PARA ARGUMENTOS DE HERRAMIENTAS (¡Importante para tipado seguro!)
// Estas interfaces definen la forma de los 'arguments' para cada tool_call.
interface GmailSendArgs {
  recipient: string;
  subject: string;
  body: string;
  recipient_name?: string;
}

interface CalendarSetArgs {
  date: string;
  time: string;
  title: string;
  duration_minutes?: number;
}

interface CalendarGetArgs {
  date?: string;
}

interface ToolCallObject {
  name: string;
  arguments: string | object;
}

@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly openAIService: OpenaiService,
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
  ) {}

  // Propiedades para la deduplicación en memoria
  private processedMessageIds = new Set<string>();
  private readonly DEDUPE_TTL_MS = 60 * 1000; // Mantener IDs por 60 segundos

  private isDuplicate(eventId: string): boolean {
    if (this.processedMessageIds.has(eventId)) {
      return true;
    }
    this.processedMessageIds.add(eventId);
    setTimeout(
      () => this.processedMessageIds.delete(eventId),
      this.DEDUPE_TTL_MS,
    );
    return false;
  }

  // **ALMACENAMIENTO DEL HISTORIAL DE CONVERSACIÓN EN MEMORIA (PARA PRUEBAS LOCALES)**
  private conversationHistory = new Map<string, ChatMessage[]>();
  private readonly MAX_CHAT_HISTORY_LENGTH = 10; // Limitar el historial para el LLM (5 pares de turno)

  private async processIncomingMessage(
    from: string,
    textBody: string,
  ): Promise<void> {
    console.log(chalk.blue(`[Recibido] Mensaje de ${from}: ${textBody}`));

    const currentChatHistory = this.conversationHistory.get(from) || [];
    currentChatHistory.push({ role: 'user', content: textBody });

    const aiResponse = await this.openAIService.getAIResponse(
      textBody,
      currentChatHistory,
    );

    if (currentChatHistory.length > this.MAX_CHAT_HISTORY_LENGTH) {
      currentChatHistory.splice(
        0,
        currentChatHistory.length - this.MAX_CHAT_HISTORY_LENGTH,
      );
    }
    this.conversationHistory.set(from, currentChatHistory);

    if (typeof aiResponse === 'object' && 'tool_call' in aiResponse) {
      const toolCallObject = aiResponse.tool_call as ToolCallObject;
      console.log(
        chalk.cyan(
          `[AGENTE] Respuesta de IA con tool_call: ${JSON.stringify(
            toolCallObject,
          )}`,
        ),
      );
      if (toolCallObject && typeof toolCallObject === 'object') {
        const toolName = toolCallObject.name;
        let toolArgs: any;
        if (typeof toolCallObject.arguments === 'string') {
          toolArgs = JSON.parse(toolCallObject.arguments);
        } else {
          toolArgs = toolCallObject.arguments;
        }

        console.log(
          chalk.magenta(
            `[AGENTE] ¡Preparando para ejecutar herramienta: ${toolName} con argumentos: ${JSON.stringify(
              toolArgs,
            )}`,
          ),
        );

        let whatsappReply = '';
        if (toolName === 'Gmail_Send') {
          const gmailArgs = toolArgs as GmailSendArgs;
          await this.emailService.sendEmail(
            gmailArgs.recipient,
            gmailArgs.subject,
            gmailArgs.body,
            gmailArgs.recipient_name,
          );
          const recipientDisplay = gmailArgs.recipient_name
            ? `${gmailArgs.recipient_name} (${gmailArgs.recipient})`
            : gmailArgs.recipient;
          whatsappReply = `Correo enviado a ${recipientDisplay} con asunto "${gmailArgs.subject}".`;
        } else if (toolName === 'Calendar_Set') {
          const calendarSetArgs = toolArgs as CalendarSetArgs;
          await this.calendarService.createEvent(
            calendarSetArgs.date,
            calendarSetArgs.time,
            calendarSetArgs.title,
            calendarSetArgs.duration_minutes,
          );
          whatsappReply = `Evento "${calendarSetArgs.title}" programado para el ${calendarSetArgs.date} a las ${calendarSetArgs.time}.`;
        } else if (toolName === 'Calendar_Get') {
          const calendarGetArgs = toolArgs as CalendarGetArgs;
          const events = await this.calendarService.getEvents(
            calendarGetArgs.date || new Date().toISOString().slice(0, 10),
          );
          if (events.length === 0) {
            whatsappReply = 'No hay eventos programados para la fecha solicitada.';
          } else {
            const items = events
              .map(
                (e: any) =>
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  `${e.start.dateTime || e.start.date} - ${e.summary}`,
              )
              .join('\n');
            whatsappReply = `Eventos para ${calendarGetArgs.date || 'hoy'}:\n${items}`;
          }
        } else {
          whatsappReply =
            'Lo siento, la IA me dio una instrucción de herramienta que no reconozco.';
        }

        await this.whatsappService.sendMessage(from, whatsappReply);
        currentChatHistory.push({
          role: 'assistant',
          content: whatsappReply,
        });
      } else {
        console.warn(
          chalk.yellow(
            `[WARN] 'tool_call' encontrado, pero sin propiedad 'function' esperada. Respondiendo conversacionalmente.`,
          ),
        );
        await this.whatsappService.sendMessage(
          from,
          'Lo siento, la IA intentó usar una herramienta, pero hubo un problema interno con la instrucción. Por favor, inténtalo de nuevo.',
        );
        currentChatHistory.push({
          role: 'assistant',
          content:
            'Lo siento, la IA intentó usar una herramienta, pero hubo un problema interno con la instrucción. Por favor, inténtalo de nuevo.',
        });
      }
    } else {
      await this.whatsappService.sendMessage(from, aiResponse as string);
      currentChatHistory.push({
        role: 'assistant',
        content: aiResponse as string,
      });
    }

    console.log(chalk.green(`[Enviado] Respuesta del asistente a ${from}.`));
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
      console.error(
        chalk.red(
          'FALLO la VERIFICACION del webhook: Token incorrecto o modo inválido.',
        ),
      );
      res.status(403).send('Forbidden');
    }
  }

  @Post('webhook')
  async receiveMessage(@Req() req: Request, @Res() res: Response) {
    try {
      const messageData: WhatsAppMessagePayload = req.body;
      const entry = messageData.entry?.[0];
      const change = entry?.changes?.[0];

      if (!entry || !change) {
        console.error(
          chalk.red('Payload de WhatsApp vacío o con estructura inesperada.'),
        );
        return res.status(200).send('EVENT_RECEIVED');
      }

      if (change.field === 'messages') {
        const messages = change.value?.messages;
        const statuses = change.value?.statuses;

        if (messages && messages.length > 0) {
          const { id, from, text } = messages[0];

          if (this.isDuplicate(id)) {
            console.warn(
              chalk.yellow(
                `[DEDUPE] Mensaje de usuario duplicado/reintentado "${id}" detectado y omitido.`,
              ),
            );
            return res.status(200).send('EVENT_RECEIVED');
          }

          if (!from || !text?.body) {
            console.error(
              chalk.red('Datos de mensaje entrante incompletos:', messages[0]),
            );
            return res.status(200).json({ error: 'Incomplete message data' });
          }

          await this.processIncomingMessage(from, text.body);
          return res.status(200).send('EVENT_RECEIVED');
        } else if (statuses && statuses.length > 0) {
          const eventId = statuses[0].id;

          if (this.isDuplicate(eventId)) {
            return res.status(200).send('EVENT_RECEIVED');
          }

          const status = statuses[0];
          console.log(
            chalk.cyan(
              `[Estado] Mensaje ID ${status.id}. Estado: ${status.status}.`,
            ),
          );

          if (status.pricing) {
            if (status.pricing.billable === true) {
              /* console.warn(
                chalk.bold.red(
                  `  !!! Atención: Este mensaje (${status.id}) generó un costo. Categoría: ${status.pricing.category} !!!`,
                ),
              );*/
            }
          }

          return res.status(200).send('EVENT_RECEIVED');
        } else {
          console.warn(
            chalk.yellow(
              'Webhook received `field: messages` but no valid `messages` or `statuses` found.',
              change.value,
            ),
          );
          return res.status(200).send('EVENT_RECEIVED');
        }
      } else {
        console.log(
          chalk.gray(
            `Webhook recibió un evento de tipo "${change.field}" no manejado explícitamente.`,
            change.value,
          ),
        );
        return res.status(200).send('EVENT_RECEIVED');
      }
    } catch (error) {
      console.error(
        chalk.red('Error al procesar el mensaje del webhook:', error),
      );
      return res.status(200).json({ error: 'Internal server error' });
    }
  }
}
