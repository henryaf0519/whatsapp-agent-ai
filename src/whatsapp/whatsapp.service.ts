import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
@Injectable()
export class WhatsappService {
  private readonly whatsappApiUrl = process.env.WHATSAPP_API_URL || '';
  private readonly whatsappToken = process.env.WHATSAPP_TOKEN || '';

  async sendMessage(to: string, body: string): Promise<any> {
    const message = {
      messaging_product: 'whatsapp',
      to,
      text: { body },
    };
    console.log('Enviando mensaje a WhatsApp:', message);
    try {
      const response = await axios.post(this.whatsappApiUrl, message, {
        headers: {
          Authorization: `Bearer ${this.whatsappToken}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error) {
      const err = error as { response?: { data?: any }; message?: string };
      console.error(
        'Error al enviar el mensaje:',
        err.response?.data || err.message,
      );
      throw new Error('Error al enviar mensaje a WhatsApp');
    }
  }
}
