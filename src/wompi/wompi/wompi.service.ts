/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'crypto';

@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);
  private readonly apiUrl: string;
  private readonly privateKey: string;
  private readonly eventsSecret: string;

  constructor(private readonly configService: ConfigService) {
    if (!this.configService.get<string>('WOMPI_API_URL')) {
      this.logger.error(
        'WOMPI_API_URL is not set in the environment variables',
      );
      throw new Error('WOMPI_API_URL is required');
    }
    if (!this.configService.get<string>('WOMPI_PRIVATE_KEY')) {
      this.logger.error(
        'WOMPI_PRIVATE_KEY is not set in the environment variables',
      );
      throw new Error('WOMPI_PRIVATE_KEY is required');
    }
    if (!this.configService.get<string>('WOMPI_EVENTS_SECRET')) {
      this.logger.error(
        'WOMPI_EVENTS_SECRET is not set in the environment variables',
      );
      throw new Error('WOMPI_EVENTS_SECRET is required');
    }

    this.apiUrl = this.configService.get<string>('WOMPI_API_URL')!;
    this.privateKey = this.configService.get<string>('WOMPI_PRIVATE_KEY')!;
    this.eventsSecret = this.configService.get<string>('WOMPI_EVENTS_SECRET')!;
  }

  async createPaymentLink(
    amountInCents: number,
    reference: string,
  ): Promise<string | null> {
    try {
      console.log('URL de Wompi cargada:', this.apiUrl);
      const response = await axios.post(
        `${this.apiUrl}/payment_links`,
        {
          name: `Pago Afiliamos - ${reference}`,
          description: 'Pago de servicios de seguridad social',
          single_use: true,
          amount_in_cents: amountInCents,
          collect_shipping: false,
          currency: 'COP',
          // Puedes añadir más campos según la documentación de Wompi
        },
        {
          headers: {
            Authorization: `Bearer ${this.privateKey}`,
          },
        },
      );

      const paymentLinkId = response.data.data.id;
      const paymentUrl = `https://checkout.wompi.co/l/${paymentLinkId}`;
      this.logger.log(`Link de pago creado: ${paymentUrl}`);
      return paymentUrl;
    } catch (error) {
      this.logger.error('Error al crear el link de pago en Wompi', error);
      return null;
    }
  }

  validateWebhookSignature(event: any): boolean {
    const signature = event.signature.checksum;
    const properties = event.signature.properties;
    let concatenatedValues = '';

    properties.forEach((prop) => {
      const value = prop.split('.').reduce((o, i) => o[i], event.data);
      concatenatedValues += value;
    });

    concatenatedValues += event.timestamp + this.eventsSecret;

    const hash = createHash('sha256').update(concatenatedValues).digest('hex');

    return hash === signature;
  }
}
