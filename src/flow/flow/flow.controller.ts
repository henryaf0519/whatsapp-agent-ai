import {
  Controller,
  Post,
  Body,
  Res,
  Logger,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { FlowService } from './flow.service';

@Controller('flow')
export class FlowController {
  private readonly logger = new Logger(FlowController.name);
  constructor(private readonly flowService: FlowService) {}

  @Post('webhook')
  async handleFlowWebhook(@Body() body: any, @Res() res: Response) {
    this.logger.log(
      'Petición de Flow recibida (modo de prueba, sin validación de firma)',
    );

    try {
      // Directamente procesamos los datos y obtenemos la respuesta cifrada
      const encryptedResponsePayload =
        await this.flowService.processFlowData(body);

      // Enviamos la respuesta cifrada como texto plano
      res
        .status(200)
        .header('Content-Type', 'text/plain')
        .send(encryptedResponsePayload);
    } catch (error) {
      this.logger.error('Error procesando el webhook del Flow', error);
      res.status(500).send('Error interno del servidor');
    }
  }
}
