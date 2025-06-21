import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class WhatsappService {
  private readonly whatsappApiUrl: string;
  private readonly whatsappToken: string;

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

    // El resto del código funciona como estaba.
    const response = await axios.post(this.whatsappApiUrl, body, {
      headers: {
        Authorization: `Bearer ${this.whatsappToken}`,
        'Content-Type': 'application/json',
      },
    });

    return response.data;
  }
}
