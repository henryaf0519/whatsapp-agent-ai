import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosResponse } from 'axios';

interface WhatsAppMessageBody {
  messaging_product: string;
  to: string;
  text: { body: string };
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
  private readonly whatsappApiUrl: string;
  private readonly whatsappToken: string;
  private readonly logger = new Logger(WhatsappService.name);
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor(private readonly configService: ConfigService) {
    this.whatsappApiUrl =
      this.configService.get<string>('WHATSAPP_API_URL') || '';
    this.whatsappToken =
      this.configService.get<string>('WHATSAPP_API_TOKEN') || '';

    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    if (!this.whatsappApiUrl) {
      const error =
        'WHATSAPP_API_URL no está configurada en las variables de entorno';
      this.logger.error(error);
      throw new Error(error);
    }

    if (!this.whatsappToken) {
      const error =
        'WHATSAPP_API_TOKEN no está configurada en las variables de entorno';
      this.logger.error(error);
      throw new Error(error);
    }

    // Validate URL format
    try {
      new URL(this.whatsappApiUrl);
    } catch {
      const error = 'WHATSAPP_API_URL no tiene un formato válido de URL';
      this.logger.error(error);
      throw new Error(error);
    }
  }

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

  async sendMessage(to: string, message: string): Promise<WhatsAppApiResponse> {
    try {
      // Validate inputs
      this.validateMessageInput(to, message);

      const body: WhatsAppMessageBody = {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''), // Clean phone number
        text: { body: message.trim() },
      };

      this.logger.log(`Enviando mensaje WhatsApp a: ${to}`);

      let lastError: Error | null = null;

      // Retry logic
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const response: AxiosResponse<WhatsAppApiResponse> = await axios.post(
            this.whatsappApiUrl,
            body,
            {
              headers: {
                Authorization: `Bearer ${this.whatsappToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 10000, // 10 seconds timeout
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

  /**
   * Health check method to verify WhatsApp API connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test to verify API connectivity without sending a message
      const response = await axios.get(
        this.whatsappApiUrl.replace('/messages', ''), // Remove /messages if present
        {
          headers: {
            Authorization: `Bearer ${this.whatsappToken}`,
          },
          timeout: 5000,
        },
      );
      return response.status === 200;
    } catch (error) {
      this.logger.error('WhatsApp API health check failed:', error);
      return false;
    }
  }
}
