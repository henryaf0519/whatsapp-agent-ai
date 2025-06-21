import { Controller, Post, Body, Req, Res, Get } from '@nestjs/common';
import { Request, Response } from 'express';
import { OpenaiService } from '../openai/openai.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

// Opcional: Puedes extender esta interfaz si deseas tipar más a fondo los 'statuses'
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

@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly openAIService: OpenaiService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // Propiedades para la deduplicación en memoria
  private processedMessageIds = new Set<string>();
  private readonly DEDUPE_TTL_MS = 60 * 1000; // Mantener IDs por 60 segundos

  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const VERIFY_TOKEN = '123456';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === VERIFY_TOKEN) {
      console.log('\x1b[32m%s\x1b[0m', 'Webhook VERIFICADO correctamente.'); // Verde
      res.status(200).send(challenge);
    } else {
      console.error(
        '\x1b[31m%s\x1b[0m',
        'FALLO la VERIFICACION del webhook: Token incorrecto o modo inválido.', // Rojo
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
          '\x1b[31m%s\x1b[0m',
          'Payload de WhatsApp vacío o con estructura inesperada.',
        ); // Rojo
        return res.status(200).send('EVENT_RECEIVED');
      }

      // --- Lógica de Deduplicación ---
      let eventIdToDeduplicate: string | undefined;

      // Intentamos obtener un ID único del evento para la deduplicación
      if (
        change.field === 'messages' &&
        change.value?.messages &&
        change.value.messages.length > 0
      ) {
        eventIdToDeduplicate = change.value.messages[0].id;
      } else if (
        change.field === 'messages' &&
        change.value?.statuses &&
        change.value.statuses.length > 0
      ) {
        eventIdToDeduplicate = change.value.statuses[0].id;
      } else if (entry?.id) {
        // Fallback al ID de la entrada si no hay mensaje/estado específico
        eventIdToDeduplicate = entry.id;
      }

      if (eventIdToDeduplicate) {
        if (this.processedMessageIds.has(eventIdToDeduplicate)) {
          console.warn(
            '\x1b[33m%s\x1b[0m', // Amarillo
            `[DEDUPE] Evento duplicado/reintentado "${eventIdToDeduplicate}" detectado y omitido.`,
          );
          return res.status(200).send('EVENT_RECEIVED'); // Ignorar y responder 200 OK
        }
        this.processedMessageIds.add(eventIdToDeduplicate);
        // Limpiar el Set después de un tiempo para que no crezca indefinidamente
        setTimeout(
          () => this.processedMessageIds.delete(eventIdToDeduplicate),
          this.DEDUPE_TTL_MS,
        );
      }
      // --- Fin Lógica de Deduplicación ---

      if (change.field === 'messages') {
        const messages = change.value?.messages;
        const statuses = change.value?.statuses;

        if (messages && messages.length > 0) {
          const message = messages[0];
          const { from, text } = message;

          if (!from || !text?.body) {
            console.error(
              '\x1b[31m%s\x1b[0m',
              'Datos de mensaje entrante incompletos:',
              message,
            ); // Rojo
            return res.status(200).json({ error: 'Incomplete message data' });
          }

          console.log(
            '\x1b[34m%s\x1b[0m',
            `[Recibido] Mensaje de ${from}: ${text.body}`,
          ); // Azul

          const aiResponse = await this.openAIService.getAIResponse(text.body);

          console.log(
            '\x1b[33m%s\x1b[0m',
            `[Enviando] Respuesta de IA: ${aiResponse}`,
          ); // Amarillo
          await this.whatsappService.sendMessage(from, aiResponse);

          console.log(
            '\x1b[32m%s\x1b[0m',
            `[Enviado] Respuesta de IA a ${from}.`,
          ); // Verde
          return res.status(200).send('EVENT_RECEIVED');
        } else if (statuses && statuses.length > 0) {
          const status = statuses[0];
          console.log(
            '\x1b[36m%s\x1b[0m', // Cian
            `[Estado] Mensaje ID ${status.id}. Estado: ${status.status}.`,
          );

          if (status.pricing) {
            console.log(
              '\x1b[35m%s\x1b[0m', // Magenta
              `  [Precios] Billable: ${status.pricing.billable}, Categoría: ${status.pricing.category}, Modelo: ${status.pricing.pricing_model}`,
            );
            if (status.pricing.billable === true) {
              console.warn(
                '\x1b[1m\x1b[31m%s\x1b[0m', // Rojo brillante
                `  !!! Atención: Este mensaje (${status.id}) generó un costo. Categoría: ${status.pricing.category} !!!`,
              );
            } else {
              console.log(
                '\x1b[32m%s\x1b[0m', // Verde
                `  Este mensaje (${status.id}) NO generó un costo. Categoría: ${status.pricing.category}.`,
              );
            }
          } else {
            console.log(
              '\x1b[90m%s\x1b[0m', // Gris
              '  No se encontró información de pricing para esta actualización de estado.',
            );
          }

          return res.status(200).send('EVENT_RECEIVED');
        } else {
          console.warn(
            '\x1b[33m%s\x1b[0m', // Amarillo
            'Webhook received `field: messages` but no valid `messages` or `statuses` found.',
            change.value,
          );
          return res.status(200).send('EVENT_RECEIVED');
        }
      } else {
        console.log(
          '\x1b[90m%s\x1b[0m', // Gris
          `Webhook recibió un evento de tipo "${change.field}" no manejado explícitamente.`,
          change.value,
        );
        return res.status(200).send('EVENT_RECEIVED');
      }
    } catch (error) {
      console.error(
        '\x1b[31m%s\x1b[0m',
        'Error al procesar el mensaje del webhook:',
        error,
      ); // Rojo
      return res.status(200).json({ error: 'Internal server error' });
    }
  }
}
