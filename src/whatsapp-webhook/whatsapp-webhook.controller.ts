import { Controller, Post, Get, Req, Res } from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import chalk from 'chalk';
import { PruebaService } from 'src/agent/agent.service';
interface WhatsAppMessagePayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messages?: Array<{
          from: string; // El número de teléfono del remitente
          id: string; // ID único del mensaje de WhatsApp
          text?: { body: string }; // Contenido del mensaje de texto
        }>;
      };
      field: string;
    }>;
  }>;
}

@Controller('whatsapp')
export class WhatsappWebhookController {
  private processedMessageIds = new Set<string>();
  private readonly DEDUPE_TTL_MS = 60 * 1000;

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly chatbotService: PruebaService,
    private readonly configService: ConfigService,
    //private readonly agentService: AgentService,
  ) {}

  private isDuplicate(id: string): boolean {
    if (this.processedMessageIds.has(id)) return true;
    this.processedMessageIds.add(id);
    setTimeout(() => this.processedMessageIds.delete(id), this.DEDUPE_TTL_MS);
    return false;
  }

  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const VERIFY_TOKEN = this.configService.get<string>(
      'WHATSAPP_VERIFY_TOKEN',
    );
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log(
          chalk.green('Webhook VERIFICADO correctamente (WhatsApp).'),
        );
        return res.status(200).send(challenge);
      } else {
        console.error(
          chalk.red(
            'Fallo verificación webhook (WhatsApp): Token o modo incorrecto.',
          ),
        );
        return res.status(403).send('Forbidden: Token o modo incorrecto.');
      }
    }
    console.error(
      chalk.red('Fallo verificación webhook (WhatsApp): Parámetros faltantes.'),
    );
    return res
      .status(400)
      .send('Bad Request: Parámetros de verificación faltantes.');
  }

  @Post('webhook')
  async receiveMessage(@Req() req: Request, @Res() res: Response) {
    try {
      const payload = req.body as WhatsAppMessagePayload;
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];

      if (change?.field === 'messages') {
        const message = change.value.messages?.[0];
        if (
          message &&
          message.text &&
          message.from &&
          !this.isDuplicate(message.id)
        ) {
          console.log('mensaje;', message);
          const reply = await this.chatbotService.conversar(
            '12345',
            message.text.body,
          );
          console.log(reply);
          await this.whatsappService.sendMessage(message.from, reply);
        } else {
          console.log(
            chalk.yellow(
              '[WhatsApp - Info] Mensaje no procesado (no es texto, duplicado, o falta info):',
            ),
            JSON.stringify(message),
          );
        }
      } else {
        console.log(
          chalk.gray('[WhatsApp - Info] Recibido otro tipo de cambio:'),
          JSON.stringify(change),
        );
      }
    } catch (err) {
      console.error(chalk.red('Error procesando webhook de WhatsApp:'), err);
    }
    return res.status(200).send('EVENT_RECEIVED');
  }
}
