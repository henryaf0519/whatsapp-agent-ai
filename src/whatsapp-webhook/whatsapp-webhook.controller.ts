import { Controller, Post, Body, Req, Res, Get } from '@nestjs/common';
import { Request, Response } from 'express';

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
  @Get('webhook')
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const VERIFY_TOKEN = '123456';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    console.log('Verifying webhook:', { mode, token, challenge });
    if (mode && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Forbidden');
    }
  }

  @Post('webhook')
  receiveMessage(@Req() req: Request, @Res() res: Response) {
    try {
      const messageData: WhatsAppMessage = req.body;

      if (
        !messageData ||
        !Array.isArray(messageData.entry) ||
        messageData.entry.length === 0 ||
        !messageData.entry[0].changes ||
        !Array.isArray(messageData.entry[0].changes) ||
        messageData.entry[0].changes.length === 0
      ) {
        console.error('Invalid message structure:', messageData);
        return res.status(400).json({ error: 'Invalid message structure' });
      }

      const messages = messageData.entry[0].changes[0].value.messages;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        console.error('No messages found:', messageData);
        return res.status(400).json({ error: 'No messages found' });
      }

      const message = messages[0];
      if (!message.from || !message.text || !message.text.body) {
        console.error('Incomplete message data:', message);
        return res.status(400).json({ error: 'Incomplete message data' });
      }

      console.log(`Mensaje recibido de ${message.from}: ${message.text.body}`);
      return res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('Error processing message:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
