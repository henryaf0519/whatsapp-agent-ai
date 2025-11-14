/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  Query,
  Res,
  Post,
  Body,
  Req,
  UseGuards,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'googleapis/node_modules/google-auth-library';
import { EmailService } from './email.service';
import { CalendarService } from '../calendar/calendar.service';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

@Controller('email')
export class EmailController {
  private oauth2Client: OAuth2Client;
  private readonly logger = new Logger(EmailController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
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

  @Post('test-calendar')
  @UseGuards(AuthGuard('jwt')) // Protegido, para saber qué usuario está probando
  async testCreateEvent(@Req() req: Request) {
    // Obtenemos el number_id del usuario desde su token JWT
    const numberId = (req.user as any).number_id;

    if (!numberId) {
      throw new InternalServerErrorException(
        'No se encontró number_id en el token',
      );
    }

    try {
      this.logger.log(`Iniciando prueba de calendario para: ${numberId}`);

      const event = await this.calendarService.createEvent(
        numberId, // El ID del cliente
        '2025-11-14', // Fecha de prueba
        '15:00:00', // Hora de prueba
        '¡Prueba de Cita desde API!', // Título del evento
        60, // Duración
        ['Juan.nomadadigital@gmail.com'], // Invitados
      );

      return {
        message: '¡Evento de prueba creado exitosamente!',
        data: event,
      };
    } catch (error) {
      this.logger.error('Fallo la prueba de crear evento', error);
      // Re-lanzar el error para verlo en Postman
      throw new InternalServerErrorException(
        `Fallo la prueba: ${(error as Error).message}`,
      );
    }
  }
}
