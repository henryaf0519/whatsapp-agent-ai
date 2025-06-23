import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class EmailService {
  private readonly gmailToken: string;
  private readonly fromEmail: string;
  private readonly gmailApiUrl =
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

  constructor(private readonly configService: ConfigService) {
    this.gmailToken = this.configService.get<string>('GMAIL_ACCESS_TOKEN') || '';
    this.fromEmail = this.configService.get<string>('GMAIL_FROM_EMAIL') || '';
  }

  async sendEmail(
    recipient: string,
    subject: string,
    body: string,
    recipientName?: string,
  ): Promise<unknown> {
    const greeting = recipientName ? `Dear ${recipientName},\n\n` : '';
    const message =
      `From: ${this.fromEmail}\r\n` +
      `To: ${recipient}\r\n` +
      `Subject: ${subject}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
      `${greeting}${body}`;

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await axios.post(
      this.gmailApiUrl,
      { raw: encodedMessage },
      {
        headers: {
          Authorization: `Bearer ${this.gmailToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data;
  }
}
