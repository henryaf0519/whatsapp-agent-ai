import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WhatsappService {
  private readonly whatsappApiUrl = `https://graph.facebook.com/v22.0/647491045122813/messages`;
  private readonly whatsappToken =
    'EAAIBSmxQ3OwBO63SxQow2cd9tGWhT90bR2g1sd3wriOUG845sHKEHGRH578eTE9ZBOEiv8K4g9Vb6ee96OIStydmKYjslzeLN8vLoCJAqJ9ez8ukSRgdqf02oPsnEuq7X0svXiGTtZADjAzNrZBCTveZAmPkpc2yoCcjjUkS4JpcMyBrl6L2czZAAdXW6Yi6M65G1vNT787Y6cC9ME1QR8VhsDiCcDjxKLnPZCJDPw9vXJ2AZDZD';

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
