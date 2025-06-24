import { Controller, Get, Query, Res, Post, Body } from '@nestjs/common';
import { Response } from 'express';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'googleapis/node_modules/google-auth-library';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  private oauth2Client: OAuth2Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GMAIL_CLIENT_ID'),
      this.configService.get<string>('GMAIL_CLIENT_SECRET'),
      this.configService.get<string>('GMAIL_REDIRECT_URI'),
    );
  }
  @Get('auth')
  auth(@Res() res: Response) {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.send'],
    });
    res.redirect(url); // Use this.oauth2Client
  }

  @Get('oauth2callback')
  async oauth2callback(@Query('code') code: string, @Res() res: Response) {
    if (!code) return res.status(400).send('Falta el código');
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      // Guarda tokens.refresh_token si quieres persistir la sesión
      res.send('Autorización completada.');
    } catch (err) {
      console.error(err);
      res.status(500).send('Error obteniendo tokens');
    }
  }
  @Post('send')
  sendMail(@Body() payload: { to: string; subject: string; body: string }) {
    return this.emailService.sendEmail(
      payload.to,
      payload.subject,
      payload.body,
    );
  }
}
