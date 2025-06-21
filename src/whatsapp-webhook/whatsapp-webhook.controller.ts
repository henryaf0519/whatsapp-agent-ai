import { Controller, Post, Body, Req, Res, Get } from '@nestjs/common';
import { Request, Response } from 'express';
import { OpenaiService } from '../openai/openai.service';
import { WhatsappService } from '../whatsapp/whatsapp.service'; // Importar el servicio de WhatsApp si es necesario

interface WhatsAppMessage {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messages: Array<{
          from: string;
          id: string;
          text: {
            body: string;
          };
        }>;
      };
      field: string;
    }>;
  }>;
}

@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly openAIService: OpenaiService,
    private readonly whatsappService: WhatsappService, // Importar el servicio de WhatsApp si es necesario
  ) {}

  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const VERIFY_TOKEN = '123456';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Forbidden');
    }
  }

  @Post('webhook')
  async receiveMessage(@Req() req: Request, @Res() res: Response) {
    try {
      const messageData: WhatsAppMessage = req.body;

      // Verificar que la estructura del mensaje es válida
      const entry = messageData.entry?.[0];
      const changes = entry?.changes?.[0];
      const messages = changes?.value?.messages;

      if (!messages || messages.length === 0) {
        console.error('No messages found:', messageData);
        return res.status(400).json({ error: 'No messages found' });
      }

      const message = messages[0];
      const { from, text } = message;

      if (!from || !text?.body) {
        console.error('Incomplete message data:', message);
        return res.status(400).json({ error: 'Incomplete message data' });
      }

      console.log(`Mensaje recibido de ${from}: ${text.body}`);

      // Obtener la respuesta de la IA
      const aiResponse = await this.openAIService.getAIResponse(text.body);

      // Enviar la respuesta al número de WhatsApp
      await this.whatsappService.sendMessage(from, aiResponse);

      return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('Error processing message:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
