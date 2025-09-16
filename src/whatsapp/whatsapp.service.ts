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
      // Validate inputs
      this.validateMessageInput(to, message);
      const businessCredentials =
        await this.db.findBusinessByNumberId(businessId);
      if (!businessCredentials) {
        throw new HttpException(
          'No se encontraron credenciales para la cuenta de WhatsApp Business proporcionada.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const whatsappToken = businessCredentials.whatsapp_token;
      if (!whatsappToken) {
        throw new HttpException(
          'Credenciales incompletas para la cuenta de WhatsApp Business.',
          HttpStatus.BAD_REQUEST,
        );
      }

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

  async sendTemplateMessage(
    to: string,
    businessId: string,
    templateName: string,
  ): Promise<WhatsAppApiResponse> {
    try {
      // Validate inputs
      this.validateMessageInput(to, templateName);
      const businessCredentials =
        await this.db.findBusinessByNumberId(businessId);
      if (!businessCredentials) {
        throw new HttpException(
          'No se encontraron credenciales para la cuenta de WhatsApp Business proporcionada.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const whatsappToken = businessCredentials.whatsapp_token;
      if (!whatsappToken) {
        throw new HttpException(
          'Credenciales incompletas para la cuenta de WhatsApp Business.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const body: WhatsAppMessageBody = {
        messaging_product: 'whatsapp',
        type: 'template',
        to: to.replace(/\D/g, ''),
        template: {
          name: templateName,
          language: {
            code: 'es_CO', // O "es" si la plantilla está en español
          },
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
      const businessCredentials =
        await this.db.findBusinessByNumberId(businessId);
      if (!businessCredentials) {
        throw new HttpException(
          'No se encontraron credenciales para la cuenta de WhatsApp Business proporcionada.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const whatsappToken = businessCredentials.whatsapp_token;
      if (!whatsappToken) {
        throw new HttpException(
          'Credenciales incompletas para la cuenta de WhatsApp Business.',
          HttpStatus.BAD_REQUEST,
        );
      }

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
      const businessCredentials =
        await this.db.findBusinessByNumberId(businessId);
      if (!businessCredentials) {
        throw new HttpException(
          'No se encontraron credenciales para la cuenta de WhatsApp Business proporcionada.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const whatsappToken = businessCredentials.whatsapp_token;
      if (!whatsappToken) {
        throw new HttpException(
          'Credenciales incompletas para la cuenta de WhatsApp Business.',
          HttpStatus.BAD_REQUEST,
        );
      }
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
    const businessCredentials =
      await this.db.findBusinessByNumberId(businessId);
    if (!businessCredentials) {
      throw new HttpException(
        'No se encontraron credenciales para la cuenta de WhatsApp Business proporcionada.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const whatsappToken = businessCredentials.whatsapp_token;
    if (!whatsappToken) {
      throw new HttpException(
        'Credenciales incompletas para la cuenta de WhatsApp Business.',
        HttpStatus.BAD_REQUEST,
      );
    }

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
}
