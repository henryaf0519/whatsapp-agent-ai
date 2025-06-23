import { Controller, Post, Body, Req, Res, Get } from '@nestjs/common';
import { Request, Response } from 'express';
import { OpenaiService } from '../openai/openai.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
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
  ) {}

  // Propiedades para la deduplicación en memoria
  private processedMessageIds = new Set<string>();
  private readonly DEDUPE_TTL_MS = 60 * 1000; // Mantener IDs por 60 segundos

  // **ALMACENAMIENTO DEL HISTORIAL DE CONVERSACIÓN EN MEMORIA (PARA PRUEBAS LOCALES)**
  private conversationHistory = new Map<string, ChatMessage[]>();
  private readonly MAX_CHAT_HISTORY_LENGTH = 10; // Limitar el historial para el LLM (5 pares de turno)

  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const VERIFY_TOKEN = '123456';
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

      // --- Lógica de Deduplicación ---
      let eventIdToDeduplicate: string | undefined;
      let fromNumber: string | undefined; // Para obtener el número del remitente y gestionar el historial

      if (change.field === 'messages') {
        const messages = change.value?.messages;
        const statuses = change.value?.statuses;

        if (messages && messages.length > 0) {
          eventIdToDeduplicate = messages[0].id;
          fromNumber = messages[0].from; // Obtener el número de WhatsApp del remitente

          if (this.processedMessageIds.has(eventIdToDeduplicate)) {
            console.warn(
              chalk.yellow(
                `[DEDUPE] Mensaje de usuario duplicado/reintentado "${eventIdToDeduplicate}" detectado y omitido.`,
              ),
            );
            return res.status(200).send('EVENT_RECEIVED');
          }
          this.processedMessageIds.add(eventIdToDeduplicate);
          setTimeout(
            () => this.processedMessageIds.delete(eventIdToDeduplicate!),
            this.DEDUPE_TTL_MS,
          );

          const message = messages[0];
          const { from, text } = message;

          if (!from || !text?.body) {
            console.error(
              chalk.red('Datos de mensaje entrante incompletos:', message),
            );
            return res.status(200).json({ error: 'Incomplete message data' });
          }

          console.log(
            chalk.blue(`[Recibido] Mensaje de ${from}: ${text.body}`),
          );

          // --- Gestión del Historial de Conversación en memoria ---
          const currentChatHistory = this.conversationHistory.get(from) || [];
          currentChatHistory.push({ role: 'user', content: text.body });

          // LLAMADA A LA IA: PASANDO EL HISTORIAL COMPLETO
          const aiResponse = await this.openAIService.getAIResponse(
            text.body,
            currentChatHistory,
          );

          // Limitar el historial antes de guardarlo de nuevo en la Map
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
            // Verificación y casting seguro para ChatCompletionToolCall
            if (toolCallObject && typeof toolCallObject === 'object') {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              const toolName = toolCallObject.name;
              // Asegurarse de que arguments es string antes de parsear
              let toolArgs: any;
              if (typeof toolCallObject.arguments === 'string') {
                toolArgs = JSON.parse(toolCallObject.arguments); // Parsear el string JSON a objeto
              } else {
                toolArgs = toolCallObject.arguments; // Si ya es objeto, usarlo directamente
              }

              console.log(
                chalk.magenta(
                  `[AGENTE] ¡Preparando para ejecutar herramienta: ${toolName} con argumentos: ${JSON.stringify(toolArgs)}`,
                ),
              );

              let whatsappReply = '';
              if (toolName === 'Gmail_Send') {
                const gmailArgs = toolArgs as GmailSendArgs; // Casting a interfaz específica
                const recipientDisplay = gmailArgs.recipient_name
                  ? `${gmailArgs.recipient_name} (${gmailArgs.recipient})`
                  : gmailArgs.recipient;
                whatsappReply = `¡Excelente! He preparado el correo para ${recipientDisplay} con el asunto "${gmailArgs.subject}". Se enviará con el siguiente contenido:\n\n---\n${gmailArgs.body}\n---.\n\nRecuerda que esta es una simulación. Para el envío real, deberías integrar la API de Gmail aquí.`;
              } else if (toolName === 'Calendar_Set') {
                const calendarSetArgs = toolArgs as CalendarSetArgs; // Casting a interfaz específica
                whatsappReply = `¡Listo! He simulado la programación de "${calendarSetArgs.title}" para el ${calendarSetArgs.date} a las ${calendarSetArgs.time}.`;
              } else if (toolName === 'Calendar_Get') {
                const calendarGetArgs = toolArgs as CalendarGetArgs; // Casting a interfaz específica
                whatsappReply = `Simulando la consulta del calendario para ${calendarGetArgs.date || 'hoy'}.`;
              } else {
                whatsappReply =
                  'Lo siento, la IA me dio una instrucción de herramienta que no reconozco en esta simulación.';
              }

              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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
            // Es un mensaje conversacional (texto plano de la IA)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            await this.whatsappService.sendMessage(from, aiResponse as string);
            currentChatHistory.push({
              role: 'assistant',
              content: aiResponse as string,
            });
          }

          console.log(
            chalk.green(`[Enviado] Respuesta del asistente a ${from}.`),
          );
          return res.status(200).send('EVENT_RECEIVED');
        } else if (statuses && statuses.length > 0) {
          eventIdToDeduplicate = statuses[0].id;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          fromNumber = statuses[0].recipient_id;

          if (this.processedMessageIds.has(eventIdToDeduplicate)) {
            /*console.warn(
              chalk.yellow(
                `[DEDUPE] Actualización de estado duplicada/reintentada "${eventIdToDeduplicate}" detectado y omitida.`,
              ),
            );*/
            return res.status(200).send('EVENT_RECEIVED');
          }
          this.processedMessageIds.add(eventIdToDeduplicate);
          setTimeout(
            () => this.processedMessageIds.delete(eventIdToDeduplicate!),
            this.DEDUPE_TTL_MS,
          );

          const status = statuses[0];
          console.log(
            chalk.cyan(
              `[Estado] Mensaje ID ${status.id}. Estado: ${status.status}.`,
            ),
          );

          if (status.pricing) {
            /* console.log(
              chalk.magenta(
                `  [Precios] Billable: ${status.pricing.billable}, Categoría: ${status.pricing.category}, Modelo: ${status.pricing.pricing_model}`,
              ),
            );*/
            if (status.pricing.billable === true) {
              /*  console.warn(
                chalk.bold.red(
                  `  !!! Atención: Este mensaje (${status.id}) generó un costo. Categoría: ${status.pricing.category} !!!`,
                ),
              );*/
            } else {
              /*console.log(
                chalk.green(
                  `  Este mensaje (${status.id}) NO generó un costo. Categoría: ${status.pricing.category}.`,
                ),
              );*/
            }
          } else {
            /*console.log(
              chalk.gray(
                '  No se encontró información de pricing para esta actualización de estado.',
              ),
            );*/
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
