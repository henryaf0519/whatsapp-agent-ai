/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { S3ConversationLogService } from 'src/conversation-log/s3-conversation-log.service';
import { Readable } from 'stream';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import FormData from 'form-data';
import { CreateTemplateDto } from 'src/whatsapp-templates/dto/create-template.dto';
import { Stream } from 'stream';
import { UpdateTemplateDto } from 'src/whatsapp-templates/dto/update-template.dto';

interface WhatsAppMessageBody {
  messaging_product: string;
  type?: string;
  template?: object;
  to: string;
  text?: { body: string };
}

interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

interface InteractiveButtonMessage {
  type: 'button';
  body: { text: string };
  action: {
    buttons: Array<{
      type: 'reply';
      reply: {
        id: string;
        title: string;
      };
    }>;
  };
}

interface InteractiveListMessage {
  type: 'list';
  header?: {
    type: 'text';
    text: string;
  };
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    button: string; // Texto del botón que abre la lista
    sections: Array<{
      title: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
}

type InteractiveMessage = InteractiveButtonMessage | InteractiveListMessage;
interface WhatsAppInteractiveMessageBody {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: InteractiveMessage;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Service: S3ConversationLogService,
    @Inject(forwardRef(() => DynamoService))
    private readonly db: DynamoService,
  ) {}

  private validateMessageInput(to: string, message: string): void {
    if (!to || typeof to !== 'string' || to.trim().length === 0) {
      throw new HttpException(
        'El número de teléfono de destino es requerido y debe ser válido',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !message ||
      typeof message !== 'string' ||
      message.trim().length === 0
    ) {
      throw new HttpException(
        'El mensaje es requerido y no puede estar vacío',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\d{10,15}$/;
    const cleanPhone = to.replace(/\D/g, '');
    if (!phoneRegex.test(cleanPhone)) {
      throw new HttpException(
        'El formato del número de teléfono no es válido',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate message length (WhatsApp limit is 4096 characters)
    if (message.length > 4096) {
      throw new HttpException(
        'El mensaje excede el límite máximo de 4096 caracteres',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private handleAxiosError(error: AxiosError, attempt: number): never {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const responseData = error.response?.data;

    this.logger.error(
      `WhatsApp API Error (Intento ${attempt}/${this.maxRetries}): ` +
        `Status: ${status}, StatusText: ${statusText}, ` +
        `Data: ${JSON.stringify(responseData)}`,
    );

    switch (status) {
      case 400:
        throw new HttpException(
          `Solicitud inválida a WhatsApp API: ${JSON.stringify(responseData)}`,
          HttpStatus.BAD_REQUEST,
        );
      case 401:
        throw new HttpException(
          'Token de WhatsApp API inválido o expirado. Verifica WHATSAPP_API_TOKEN.',
          HttpStatus.UNAUTHORIZED,
        );
      case 403:
        throw new HttpException(
          'Acceso prohibido a WhatsApp API. Verifica permisos del token.',
          HttpStatus.FORBIDDEN,
        );
      case 404:
        throw new HttpException(
          'Endpoint de WhatsApp API no encontrado. Verifica WHATSAPP_API_URL.',
          HttpStatus.NOT_FOUND,
        );
      case 429:
        throw new HttpException(
          'Límite de velocidad excedido en WhatsApp API. Intenta más tarde.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 500:
      case 502:
      case 503:
      case 504:
        throw new HttpException(
          'Error interno del servidor de WhatsApp API. Intenta más tarde.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      default:
        throw new HttpException(
          `Error inesperado de WhatsApp API: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
    }
  }

  async sendMessage(
    to: string,
    businessId: string,
    message: string,
  ): Promise<WhatsAppApiResponse> {
    try {
      this.validateMessageInput(to, message);
      const whatsappToken = await this.getWhatsappToken(businessId);
      const body: WhatsAppMessageBody = {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        text: { body: message.trim() },
      };

      this.logger.log(`Enviando mensaje WhatsApp a: ${to}`);

      let lastError: Error | null = null;
      const apiUrl = `https://graph.facebook.com/v23.0/${businessId}/messages`;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const response: AxiosResponse<WhatsAppApiResponse> = await axios.post(
            apiUrl,
            body,
            {
              headers: {
                Authorization: `Bearer ${whatsappToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 5000, // 10 seconds timeout
            },
          );
          return response.data;
        } catch (error) {
          lastError = error as Error;

          if (axios.isAxiosError(error)) {
            // Don't retry on client errors (4xx) except 429
            const status = error.response?.status;
            if (status && status >= 400 && status < 500 && status !== 429) {
              this.handleAxiosError(error, attempt);
            }

            // Retry on server errors (5xx) and 429
            if (
              attempt < this.maxRetries &&
              (status === 429 || (status && status >= 500))
            ) {
              const delayMs = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
              this.logger.warn(
                `Reintentando envío de mensaje WhatsApp en ${delayMs}ms (Intento ${attempt}/${this.maxRetries})`,
              );
              await this.delay(delayMs);
              continue;
            }

            this.handleAxiosError(error, attempt);
          } else {
            // Non-Axios error
            if (attempt < this.maxRetries) {
              const delayMs = this.retryDelay * attempt;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `Error no-HTTP, reintentando en ${delayMs}ms (Intento ${attempt}/${this.maxRetries}): ${errorMessage}`,
              );
              await this.delay(delayMs);
              continue;
            }
          }
        }
      }

      // If we get here, all retries failed
      const errorMessage = lastError?.message || 'Error desconocido';
      this.logger.error(
        `Falló el envío de mensaje WhatsApp después de ${this.maxRetries} intentos: ${errorMessage}`,
      );
      throw new HttpException(
        `Error al enviar mensaje WhatsApp después de ${this.maxRetries} intentos: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } catch (error) {
      // Re-throw HttpExceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      // Handle unexpected errors
      this.logger.error(
        `Error inesperado en sendMessage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        'Error interno del servidor al procesar mensaje WhatsApp',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendFlowDraft(
    to: string,
    businessId: string,
    token: string,
    payload: any,
  ): Promise<WhatsAppApiResponse> {
    try {
      const body = payload;

      this.logger.log(`Enviando mensaje WhatsApp a: ${to}`);

      let lastError: Error | null = null;
      const apiUrl = `https://graph.facebook.com/v23.0/${businessId}/messages`;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const response: AxiosResponse<WhatsAppApiResponse> = await axios.post(
            apiUrl,
            body,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              timeout: 5000, // 10 seconds timeout
            },
          );
          return response.data;
        } catch (error) {
          lastError = error as Error;

          if (axios.isAxiosError(error)) {
            // Don't retry on client errors (4xx) except 429
            const status = error.response?.status;
            if (status && status >= 400 && status < 500 && status !== 429) {
              this.handleAxiosError(error, attempt);
            }

            // Retry on server errors (5xx) and 429
            if (
              attempt < this.maxRetries &&
              (status === 429 || (status && status >= 500))
            ) {
              const delayMs = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
              this.logger.warn(
                `Reintentando envío de mensaje WhatsApp en ${delayMs}ms (Intento ${attempt}/${this.maxRetries})`,
              );
              await this.delay(delayMs);
              continue;
            }

            this.handleAxiosError(error, attempt);
          } else {
            // Non-Axios error
            if (attempt < this.maxRetries) {
              const delayMs = this.retryDelay * attempt;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `Error no-HTTP, reintentando en ${delayMs}ms (Intento ${attempt}/${this.maxRetries}): ${errorMessage}`,
              );
              await this.delay(delayMs);
              continue;
            }
          }
        }
      }

      // If we get here, all retries failed
      const errorMessage = lastError?.message || 'Error desconocido';
      this.logger.error(
        `Falló el envío de mensaje WhatsApp después de ${this.maxRetries} intentos: ${errorMessage}`,
      );
      throw new HttpException(
        `Error al enviar mensaje WhatsApp después de ${this.maxRetries} intentos: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } catch (error) {
      // Re-throw HttpExceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      // Handle unexpected errors
      this.logger.error(
        `Error inesperado en sendMessage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        'Error interno del servidor al procesar mensaje WhatsApp',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendInteractiveMessage(
    to: string,
    businessId: string,
    interactiveMessage: InteractiveMessage,
  ): Promise<WhatsAppApiResponse> {
    const whatsappToken = await this.getWhatsappToken(businessId);

    const body: WhatsAppInteractiveMessageBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: 'interactive',
      interactive: interactiveMessage,
    };

    this.logger.log(`Enviando mensaje interactivo a: ${to}`);
    const apiUrl = `https://graph.facebook.com/v23.0/${businessId}/messages`;

    // (Puedes reutilizar la lógica de reintentos de tus otras funciones de envío)
    try {
      const response: AxiosResponse<WhatsAppApiResponse> = await axios.post(
        apiUrl,
        body,
        {
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.handleAxiosError(error, 1);
      }
      throw new HttpException(
        'Error inesperado al enviar mensaje interactivo',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendTemplateMessage(
    to: string,
    businessId: string,
    templateName: string,
    languageCode: string,
    components: any[],
  ): Promise<WhatsAppApiResponse> {
    try {
      // Validate inputs
      this.validateMessageInput(to, templateName);
      const whatsappToken = await this.getWhatsappToken(businessId);

      const body: WhatsAppMessageBody = {
        messaging_product: 'whatsapp',
        type: 'template',
        to: to.replace(/\D/g, ''),
        template: {
          name: templateName,
          language: {
            code: languageCode,
          },
          ...(components &&
            components.length > 0 && { components: components }),
        },
      };

      this.logger.log(
        `Enviando mensaje de plantilla WhatsApp a : ${JSON.stringify(body)}`,
      );

      const apiUrl = `https://graph.facebook.com/v23.0/${businessId}/messages`;

      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const response: AxiosResponse<WhatsAppApiResponse> = await axios.post(
            apiUrl,
            body,
            {
              headers: {
                Authorization: `Bearer ${whatsappToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 5000, // 10 seconds timeout
            },
          );
          this.logger.log(
            `Respuesta de WhatsApp: ${JSON.stringify(response.data)}`,
          );
          return response.data;
        } catch (error) {
          lastError = error as Error;

          if (axios.isAxiosError(error)) {
            // Don't retry on client errors (4xx) except 429
            const status = error.response?.status;
            if (status && status >= 400 && status < 500 && status !== 429) {
              this.handleAxiosError(error, attempt);
            }

            // Retry on server errors (5xx) and 429
            if (
              attempt < this.maxRetries &&
              (status === 429 || (status && status >= 500))
            ) {
              const delayMs = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
              this.logger.warn(
                `Reintentando envío de mensaje WhatsApp en ${delayMs}ms (Intento ${attempt}/${this.maxRetries})`,
              );
              await this.delay(delayMs);
              continue;
            }

            this.handleAxiosError(error, attempt);
          } else {
            // Non-Axios error
            if (attempt < this.maxRetries) {
              const delayMs = this.retryDelay * attempt;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `Error no-HTTP, reintentando en ${delayMs}ms (Intento ${attempt}/${this.maxRetries}): ${errorMessage}`,
              );
              await this.delay(delayMs);
              continue;
            }
          }
        }
      }

      // If we get here, all retries failed
      const errorMessage = lastError?.message || 'Error desconocido';
      this.logger.error(
        `Falló el envío de mensaje WhatsApp después de ${this.maxRetries} intentos: ${errorMessage}`,
      );
      throw new HttpException(
        `Error al enviar mensaje WhatsApp después de ${this.maxRetries} intentos: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } catch (error) {
      // Re-throw HttpExceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      // Handle unexpected errors
      this.logger.error(
        `Error inesperado en sendMessage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new HttpException(
        'Error interno del servidor al procesar mensaje WhatsApp',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async sendFlowMessage(
    to: string,
    name: string,
    businessId: string,
    specificTrigger?: any, // Trigger específico del botón (opcional)
  ): Promise<WhatsAppApiResponse> {
    try {
      const whatsappToken = await this.getWhatsappToken(businessId);
      let trigger: any;

      // 1. SELECCIÓN DEL TRIGGER
      if (specificTrigger) {
        // A. Flujo por Botón (Prioridad)
        trigger = specificTrigger;
        this.logger.log(
          `[Flow] Usando trigger ESPECÍFICO (Botón): ${trigger.name}`,
        );
      } else {
        // B. Flujo por Defecto (Fallback) -> Busca el ACTIVO
        this.logger.log(
          `[Flow] No hay trigger específico. Buscando Flow Default ACTIVO...`,
        );
        trigger = await this.db.getDefaultFlowTrigger(businessId);
      }

      // 2. VALIDACIÓN
      if (!trigger || !trigger.flow_id) {
        // Nota: Ya no validamos 'isActive' aquí dentro porque getDefaultFlowTrigger
        // ya filtra por active, y specificTrigger se supone que ya viene validado o es intencional.
        const msg = `No se encontró ningún FlowTrigger válido (Específico o Default Activo) para ${businessId}`;
        this.logger.error(msg);
        throw new HttpException(msg, HttpStatus.NOT_FOUND);
      }

      // Si llegamos aquí, tenemos un trigger.
      this.logger.log(
        `[Flow] Trigger seleccionado: "${trigger.name}" (ID: ${trigger.flow_id})`,
      );

      // 3. CONSTRUCCIÓN DEL TOKEN
      const flowToken = `token_${to}_${businessId}_${trigger.flow_id}_${Date.now()}`;

      const headerText = trigger.header_text
        ? trigger.header_text.replace(/nombre/gi, name)
        : '';

      // 4. PAYLOAD
      const payload = {
        messaging_product: 'whatsapp',
        to: to,
        recipient_type: 'individual',
        type: 'interactive',
        interactive: {
          type: 'flow',
          header: {
            type: 'text',
            text: headerText ?? '',
          },
          body: {
            text:
              trigger.body_text ||
              'Por favor, interactúa con el siguiente flujo.',
          },
          footer: {
            text: trigger.footer_text ?? '',
          },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_id: trigger.flow_id,
              flow_token: flowToken,
              flow_cta: trigger.flow_cta,
              flow_action: 'navigate',
              flow_action_payload: {
                screen: trigger.screen_id,
                ...(trigger.initial_data &&
                  Object.keys(trigger.initial_data).length > 0 && {
                    data: trigger.initial_data,
                  }),
              },
            },
          },
        },
      };

      const apiUrl = `https://graph.facebook.com/v23.0/${businessId}/messages`;
      const response: AxiosResponse<WhatsAppApiResponse> = await axios.post(
        apiUrl,
        payload,
        {
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        },
      );

      return response.data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (axios.isAxiosError(error)) this.handleAxiosError(error, 1);

      this.logger.error(
        `Error en sendFlowMessage: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException(
        'Error interno enviando el flujo.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getTemplateById(templateId: string, businessId: string): Promise<any> {
    try {
      const whatsappToken = await this.getWhatsappToken(businessId);
      const apiUrl = `https://graph.facebook.com/v22.0/${templateId}`;

      this.logger.log(`Obteniendo plantilla por ID: ${templateId}`);

      const response = await axios.get(apiUrl, {
        headers: { Authorization: `Bearer ${whatsappToken}` },
      });

      return response.data;
    } catch (error) {
      this.logger.error(
        `Error al obtener la plantilla por ID "${templateId}"`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new HttpException(
        'No se pudo obtener la plantilla de WhatsApp.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async processAndUploadMedia(
    businessId: string,
    mediaId: string,
    mimeType: string,
  ): Promise<string> {
    try {
      const mediaUrl = await this.getMediaUrl(mediaId, businessId);
      const whatsappToken = await this.getWhatsappToken(businessId);

      const response: AxiosResponse = await axios({
        url: mediaUrl,
        method: 'GET',
        responseType: 'stream',
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
        },
      });

      const fileBuffer = await this.streamToBuffer(response.data);
      const contentLength = response.headers['content-length'];
      if (!contentLength) {
        throw new Error(
          'No se pudo obtener el tamaño del archivo desde los encabezados.',
        );
      }
      const fileExtension = mimeType.split('/')[1];
      const fileName = `${mediaId}.${fileExtension}`;

      return this.s3Service.uploadMedia(
        fileName,
        fileBuffer,
        mimeType,
        parseInt(contentLength, 10),
      );
    } catch (error) {
      this.logger.error('Error al procesar y subir el medio a S3.', error);
      throw new Error('Fallo al procesar el archivo multimedia.');
    }
  }

  private async getMediaUrl(
    mediaId: string,
    businessId: string,
  ): Promise<string> {
    const url = `https://graph.facebook.com/v22.0/${mediaId}`;
    try {
      const whatsappToken = await this.getWhatsappToken(businessId);
      const response: AxiosResponse<{ url: string }> = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
        },
      });
      return response.data.url;
    } catch (error) {
      this.logger.error('Error al obtener URL del medio', error);
      throw new Error('No se pudo obtener la URL del archivo.');
    }
  }

  /**
   * Obtiene las plantillas de mensajes para una cuenta de WhatsApp Business específica.
   * @param wabaId - El ID de la cuenta de WhatsApp Business del usuario.
   * @param token - El token de acceso de la API de WhatsApp del usuario.
   * @returns Una promesa que resuelve a una lista de plantillas.
   */
  async getMessageTemplates(wabaId: string, token: string): Promise<any[]> {
    const url = `https://graph.facebook.com/v23.0/${wabaId}/message_templates`;
    this.logger.log(`Obteniendo plantillas para waba_id: ${wabaId}`);

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          fields: 'name,components,language,status,category', // Campos que queremos obtener
        },
      });

      const templates = response.data.data || [];
      this.logger.log(
        `Se obtuvieron ${templates.length} plantillas para ${wabaId}.`,
      );
      return templates;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Error al obtener plantillas para ${wabaId}`,
          error.response?.data,
        );
        throw new HttpException(
          error.response?.data?.error?.message || 'Error en la API de WhatsApp',
          error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      this.logger.error('Error inesperado al obtener plantillas', error);
      throw new HttpException(
        'Error inesperado',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async downloadMedia(
    mediaId: string,
    businessId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    this.logger.log(`Obteniendo URL para mediaId: ${mediaId}`);
    const whatsappToken = await this.getWhatsappToken(businessId);

    // 1. Obtener la URL del medio
    const urlResponse = await axios.get(
      `https://graph.facebook.com/v20.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${whatsappToken}` },
      },
    );
    const mediaUrl = urlResponse.data.url;

    if (!mediaUrl) {
      throw new Error('No se pudo obtener la URL del medio.');
    }

    // 2. Descargar el archivo
    this.logger.log(`Descargando medio desde: ${mediaUrl}`);
    const downloadResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${whatsappToken}` },
      responseType: 'stream',
    });

    const buffer = await this.streamToBuffer(downloadResponse.data);
    const mimeType = downloadResponse.headers['content-type'];

    this.logger.log(
      `Medio descargado. Tamaño: ${buffer.length} bytes, Tipo: ${mimeType}`,
    );

    return { buffer, mimeType };
  }

  /**
   * Sube un buffer de un archivo multimedia directamente a S3.
   * @param key - La ruta y nombre del archivo en S3 (ej. 'audio/user-id/message-id.ogg')
   * @param body - El buffer del archivo.
   * @param contentType - El tipo MIME del archivo.
   * @returns La URL pública del archivo en S3.
   */
  async uploadMediaBuffer(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    try {
      // Usamos el s3Service que ya está inyectado en este servicio
      return this.s3Service.uploadMedia(key, body, contentType, body.length);
    } catch (error) {
      this.logger.error(
        `Fallo al subir el buffer a S3 con la clave: ${key}`,
        error as any,
      );
      throw new Error('Error al subir el archivo a S3.');
    }
  }

  async uploadMedia(
    businessId: string,
    mediaBuffer: Buffer,
    contentType: string,
  ): Promise<string> {
    try {
      const whatsappToken = await this.getWhatsappToken(businessId); // Asumo que tienes un método para obtener el token
      const apiUrl = `https://graph.facebook.com/v22.0/${businessId}/media`;

      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('file', mediaBuffer, {
        contentType,
        filename: 'template-header.png', // El nombre del archivo es irrelevante
      });

      this.logger.log(`Subiendo archivo multimedia para ${businessId}...`);

      const response = await axios.post(apiUrl, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${whatsappToken}`,
        },
      });

      if (response.data && response.data.id) {
        return response.data.id;
      } else {
        throw new Error(
          'La respuesta de la API de subida de medios no contenía un ID.',
        );
      }
    } catch (error) {
      this.logger.error(
        'Error al subir el archivo multimedia a WhatsApp',
        error instanceof Error ? error.stack : undefined,
      );
      this.handleAxiosError(error as AxiosError, 1); // Reutiliza tu manejador de errores si lo tienes
    }
  }

  async createMessageTemplate(
    business_id: string,
    wabaId: string,
    templateData: CreateTemplateDto,
  ): Promise<any> {
    const whatsappToken = await this.getWhatsappToken(business_id);
    const apiUrl = `https://graph.facebook.com/v22.0/${wabaId}/message_templates`;

    try {
      const response = await axios.post(apiUrl, templateData, {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error('Error al intentar crear la plantilla en Meta.');
      this.throwMetaError(error, 'Error al crear la plantilla en Meta');
    }
  }

  async updateTemplate(
    businessId: string,
    templateId: string,
    updateTemplateDto: UpdateTemplateDto,
  ): Promise<any> {
    const whatsappToken = await this.getWhatsappToken(businessId);
    const url = `https://graph.facebook.com/v22.0/${templateId}`;

    // El payload solo necesita los componentes, como en el ejemplo.
    const payload = {
      components: updateTemplateDto.components,
    };
    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
      });

      this.logger.log(
        `Plantilla ${templateId} actualizada exitosamente.`,
        response.data,
      );
      return response.data;
    } catch (error) {
      // Manejo de errores específico para Axios
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data;
        this.logger.error(
          `Error de la API de WhatsApp al actualizar la plantilla ${templateId}`,
          errorData,
        );
        // Propagamos el error de Meta al frontend para un feedback más claro
        throw new HttpException(
          errorData?.error?.error_user_msg ||
            'Error al comunicarse con la API de WhatsApp.',
          error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Manejo de errores genéricos
      this.logger.error(
        `Error inesperado al actualizar la plantilla ${templateId}`,
        error,
      );
      throw new HttpException(
        'Ocurrió un error inesperado en el servidor.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteTemplateByName(
    businessId: string,
    waba_id: string,
    templateName: string,
  ): Promise<{ success: boolean }> {
    const apiUrl = `https://graph.facebook.com/v22.0/${waba_id}/message_templates`;
    const whatsappToken = await this.getWhatsappToken(businessId);
    this.logger.log(
      `Intentando eliminar la plantilla: ${templateName} de WABA ID: ${businessId}`,
    );

    try {
      const response = await axios.delete(apiUrl, {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
        },
        params: {
          name: templateName,
        },
      });

      this.logger.log(
        `Plantilla "${templateName}" eliminada exitosamente. Respuesta: ${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error al intentar eliminar la plantilla "${templateName}" en Meta.`,
      );
      this.throwMetaError(
        error,
        `Error al eliminar la plantilla "${templateName}" en Meta`,
      );
    }
  }

  async uploadMediaBufferToMeta(
    business_id: string,
    appId: string,
    fileBuffer: Buffer,
    fileType: string,
  ): Promise<{ handle: string }> {
    const whatsappToken = await this.getWhatsappToken(business_id);
    const apiVersion = 'v20.0';

    // --- PASO 1: Crear la Sesión de Subida ---
    const createSessionUrl = `https://graph.facebook.com/${apiVersion}/${appId}/uploads`;
    let uploadSessionId: string | undefined;

    try {
      this.logger.log(
        `Paso 1: Creando sesión de subida para un archivo de tipo ${fileType}`,
      );
      const sessionResponse = await axios.post(createSessionUrl, null, {
        params: {
          file_length: fileBuffer.length,
          file_type: fileType,
          access_token: whatsappToken,
          messaging_product: 'whatsapp',
        },
      });
      uploadSessionId = sessionResponse.data.id;
      this.logger.log(
        `Paso 1 Exitoso. Session ID obtenido: ${uploadSessionId}`,
      );
    } catch (error) {
      this.logger.error(`Error en el Paso 1 (Crear Sesión)`);
      this.throwMetaError(
        error,
        'No se pudo iniciar la sesión de subida con Meta',
      );
      throw new HttpException(
        'No se pudo iniciar la sesión de subida con Meta',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!uploadSessionId) {
      this.logger.error('No se pudo obtener el uploadSessionId en el Paso 1.');
      throw new HttpException(
        'No se pudo obtener el uploadSessionId en el Paso 1.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // --- PASO 2: Subir el Archivo a la Sesión ---
    const uploadUrl = `https://graph.facebook.com/${apiVersion}/${uploadSessionId}`;
    try {
      this.logger.log(
        `Paso 2: Subiendo ${fileBuffer.length} bytes a la sesión ${uploadSessionId}`,
      );
      const uploadResponse = await axios.post(uploadUrl, fileBuffer, {
        headers: {
          Authorization: `OAuth ${whatsappToken}`,
          'Content-Type': fileType,
          file_offset: 0,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const fileHandle = uploadResponse.data.h;
      if (!fileHandle) {
        this.logger.error(
          `Respuesta inesperada en el Paso 2: ${JSON.stringify(uploadResponse.data)}`,
        );
        throw new HttpException(
          'La respuesta de Meta no contenía un handle de archivo.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      this.logger.log(
        `Paso 2 Exitoso. Handle de archivo obtenido: ${fileHandle}`,
      );
      return { handle: fileHandle };
    } catch (error) {
      this.logger.error(`Error en el Paso 2 (Subir Archivo)`);
      this.throwMetaError(
        error,
        'No se pudo subir el archivo a la sesión de Meta',
      );
    }
  }

  public async getWhatsappToken(businessId: string): Promise<string> {
    const businessCredentials =
      await this.db.findBusinessByNumberId(businessId);

    if (!businessCredentials || !businessCredentials.whatsapp_token) {
      throw new HttpException(
        'No se encontraron credenciales para la cuenta de WhatsApp Business proporcionada.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const token = businessCredentials.whatsapp_token;
    return token ? token : '';
  }

  private throwMetaError(error: any, defaultMessage: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error;
      const errorMessage =
        axiosError.response?.data?.error?.message || defaultMessage;
      const errorStatus =
        axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;

      this.logger.error(
        `Error de la API de Meta [${errorStatus}]: ${errorMessage}`,
      );
      this.logger.debug(
        `Respuesta completa del error: ${JSON.stringify(axiosError.response?.data)}`,
      );

      throw new HttpException(
        {
          message: `Error de la API de Meta: ${errorMessage}`,
          metaError: axiosError.response?.data?.error,
        },
        errorStatus,
      );
    }

    // Para cualquier otro tipo de error inesperado
    this.logger.error(
      `Error inesperado no relacionado con Axios: ${error.message}`,
    );
    throw new HttpException(defaultMessage, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
