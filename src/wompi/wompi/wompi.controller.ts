import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import { WompiService } from './wompi.service';
import { Response } from 'express';

@Controller('wompi')
export class WompiController {
  constructor(private readonly wompiService: WompiService) {}

  @Post('webhook')
  handleWebhook(
    @Body()
    event: {
      event: string;
      data: { transaction: { status: string; reference: string } };
    },
    @Res() res: Response,
  ) {
    if (!this.wompiService.validateWebhookSignature(event)) {
      console.log('Firma de webhook de Wompi inválida');
      return res.status(HttpStatus.UNAUTHORIZED).send('Invalid signature');
    }

    // 2. Procesar el evento
    if (event.event === 'transaction.updated') {
      const transaction = event.data.transaction;

      if (transaction.status === 'APPROVED') {
        console.log(
          `¡Pago aprobado para la referencia: ${transaction.reference}!`,
        );

        /* // Aquí va tu lógica de negocio:
        // - Actualiza el estado del pago en tu base de datos (DynamoDB).
        //   ej: await this.dynamoService.updatePaymentStatus(transaction.reference, 'PAID');

        // - Envía una confirmación al usuario por WhatsApp.
        const userPhoneNumber = transaction.reference; // Asumiendo que la referencia es el número de teléfono.
        await this.whatsappService.sendMessage(
          userPhoneNumber,
          '¡Hemos recibido tu pago exitosamente! 🎉 Gracias por tu confianza.',
        );*/
      }
    }

    // 3. Responder a Wompi que todo está bien
    res.status(HttpStatus.OK).send();
  }

  @Post('createLink')
  async createTestPaymentLink(
    @Body('amountInCents') amountInCents: number,
    @Body('reference') reference: string,
    @Res() res: Response,
  ) {
    if (!amountInCents || !reference) {
      return res.status(400).send({
        error: 'Los campos "amountInCents" y "reference" son requeridos.',
      });
    }

    const paymentLink = await this.wompiService.createPaymentLink(
      amountInCents,
      reference,
    );

    if (paymentLink) {
      return res.status(200).send({ success: true, link: paymentLink });
    } else {
      return res
        .status(500)
        .send({ error: 'No se pudo generar el link de pago.' });
    }
  }
}
