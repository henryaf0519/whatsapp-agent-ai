import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
@Injectable()
export class WhatsappService {
  private readonly whatsappApiUrl = process.env.WHATSAPP_API_URL || '';
  private readonly whatsappToken = process.env.WHATSAPP_API_TOKEN || '';

  async sendMessage(to: string, message: string): Promise<unknown> {
    const body = {
      messaging_product: 'whatsapp',
      to,
      text: { body: message },
    };

    const response = await axios.post(this.whatsappApiUrl, body, {
      headers: {
        Authorization: `Bearer ${this.whatsappToken}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data as unknown;
  }
}
