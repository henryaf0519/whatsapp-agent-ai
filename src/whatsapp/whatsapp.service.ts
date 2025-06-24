import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class WhatsappService {
  private readonly whatsappApiUrl: string;
  private readonly whatsappToken: string;
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly configService: ConfigService) {
    this.whatsappApiUrl =
      this.configService.get<string>('WHATSAPP_API_URL') || '';
    this.whatsappToken =
      this.configService.get<string>('WHATSAPP_API_TOKEN') || '';
  }

  async sendMessage(to: string, message: string): Promise<unknown> {
    const body = {
      messaging_product: 'whatsapp',
      to,
      text: { body: message },
    };

    try {
      const response = await axios.post(this.whatsappApiUrl, body, {
        headers: {
          Authorization: `Bearer ${this.whatsappToken}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 401) {
          this.logger.error(
            'WhatsApp API: token inválido o expirado (401 Unauthorized). ' +
              'Por favor, renueva WHATSAPP_API_TOKEN en tu configuración.',
          );
          throw new Error(
            'No autorizado en WhatsApp API. Token inválido o expirado.',
          );
        }
      }
      // Re-lanzar cualquier otro error
      this.logger.error(
        `Error al enviar mensaje WhatsApp: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }
}
