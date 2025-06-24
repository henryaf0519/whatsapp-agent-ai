import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'googleapis/node_modules/google-auth-library';

@Injectable()
export class EmailService {
  private readonly fromEmail: string;
  private readonly oauth2Client: OAuth2Client;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.configService.get<string>('GMAIL_REFRESH_TOKEN');
    const redirectUri = this.configService.get<string>('GMAIL_REDIRECT_URI');
    this.fromEmail = this.configService.get<string>('GMAIL_FROM_EMAIL') || '';

    if (!clientId || !clientSecret || !refreshToken || !redirectUri) {
      throw new Error('Missing Gmail OAuth2 credentials');
    }

    this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
  }

  async sendEmail(
    recipient: string,
    subject: string,
    body: string,
    recipientName?: string,
  ): Promise<unknown> {
    console.log('Sending email:', {
      recipient,
      subject,
      body,
      recipientName,
    });
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

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    try {
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
      console.log('Email sent successfully:', response.data);
      return response.data;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'message' in error) {
        console.error(
          'Error sending email:',
          (error as { message: unknown }).message,
        );
      } else {
        console.error('Error sending email:', error);
      }
      // 2) Muestra el cuerpo de respuesta de Google (status + data)
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (error as any).response
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error('→ Status:', (error as any).response.status);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error('→ Response data:', (error as any).response.data);
      }
      // 3) Muestra TODO el objeto de error (útil para Gaxios)
      if (
        error &&
        typeof error === 'object' &&
        'toJSON' in error &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        typeof (error as any).toJSON === 'function'
      ) {
        console.error(
          'Full error (JSON):',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          JSON.stringify((error as any).toJSON(), null, 2),
        );
      }
    }
  }
}
