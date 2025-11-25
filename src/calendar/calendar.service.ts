/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
// En: henryaf0519/whatsapp-agent-ai/whatsapp-agent-ai-dev/src/calendar/calendar.service.ts

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException, // <-- Importar NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import { DynamoService } from 'src/database/dynamo/dynamo.service'; // <-- NUEVO: Importar DynamoService

@Injectable()
export class CalendarService {
  // private readonly calendarId: string; // <-- ELIMINADO: Ya no se usa
  private readonly baseUrl = 'https://www.googleapis.com/calendar/v3';
  private readonly logger = new Logger(CalendarService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(
    private readonly config: ConfigService,
    private readonly dynamoService: DynamoService, // <-- Inyectar DynamoService
  ) {
    this.clientId = this.config.get<string>('GMAIL_CLIENT_ID')!;
    this.clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET')!;
    this.redirectUri = this.config.get<string>('GMAIL_REDIRECT_URI')!;

    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error(
        'Faltan credenciales OAuth2 de Google (ID, Secret o Redirect URI)',
      );
    }
  }

  /**
   * Método privado para crear un cliente OAuth2 específico para un usuario.
   * Utiliza el refresh_token guardado en DynamoDB.
   */
  private async createClientForUser(
    numberId: string,
  ): Promise<{ client: OAuth2Client; email: string }> {
    // <-- Devuelve client y email
    this.logger.log(
      `Buscando credenciales de Google para numberId: ${numberId}`,
    );

    const businessCredentials =
      await this.dynamoService.findBusinessByNumberId(numberId);

    if (!businessCredentials) {
      throw new NotFoundException(
        `No se encontraron credenciales para el businessId: ${numberId}`,
      );
    }

    const refreshToken = businessCredentials.google_refresh_token;
    const userEmail = businessCredentials.email; // Para logs y retorno

    if (!refreshToken) {
      this.logger.warn(
        `El cliente ${userEmail} (numberId: ${numberId}) no ha conectado su Google Calendar.`,
      );
      throw new InternalServerErrorException(
        'El cliente no ha conectado su cuenta de Google Calendar.',
      );
    }

    const client = new OAuth2Client(
      this.clientId,
      this.clientSecret,
      this.redirectUri,
    );

    client.setCredentials({ refresh_token: refreshToken });
    return { client, email: userEmail }; // <-- Devuelve ambos
  }

  /**
   * MODIFICADO: Ahora 'createEvent' requiere el 'numberId' del cliente
   * para saber en qué calendario crear el evento.
   */
  async createEvent(
    numberId: string,
    date: string,
    time: string,
    title: string,
    durationMinutes = 60,
    guestEmails: string[] = [],
  ): Promise<any> {
    // <--- Cambiamos retorno a 'any' para acceder a propiedades
    this.logger.log(
      `Solicitud para crear evento en calendario del cliente: ${numberId}`,
    );

    const { client, email } = await this.createClientForUser(numberId);
    const res = await client.getAccessToken();
    const token = res.token;

    if (!token) {
      throw new InternalServerErrorException('Error obteniendo access token');
    }

    const start = new Date(`${date}T${time}-05:00`);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const body: any = {
      summary: title,
      start: { dateTime: start.toISOString(), timeZone: 'America/Bogota' },
      end: { dateTime: end.toISOString(), timeZone: 'America/Bogota' },
      // ✅ SOLICITAR GOOGLE MEET
      conferenceData: {
        createRequest: {
          requestId: `req-${Date.now()}`, // ID único para la petición
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    if (guestEmails.length) {
      body.attendees = guestEmails.map((email) => ({ email }));
    }

    const calendarId = email;
    // ✅ AGREGAR 'conferenceDataVersion=1' PARA QUE GOOGLE CREE EL LINK
    const url = `${this.baseUrl}/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=all`;

    try {
      const { data } = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(
        `Evento creado exitosamente. ID: ${data.id}, Link: ${data.hangoutLink || 'No generado'}`,
      );
      return data; // Retornamos todo el objeto para sacar el link después
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.error(
          `Google Calendar API error ${err.response?.status}`,
          JSON.stringify(err.response?.data),
        );
        throw new InternalServerErrorException(
          `No se pudo crear evento: ${(err.response?.data as any)?.error?.message || err.message}`,
        );
      }
      throw new InternalServerErrorException('Error inesperado creando evento');
    }
  }

  /**
   * para saber en qué calendario crear el evento.
   */
  async getAppointments(numberId: string): Promise<any[]> {
    this.logger.log(
      `Solicitud para listar eventos del calendario: ${numberId}`,
    );
    try {
      // 1. Obtener data cruda de DynamoDB
      const rawAppointments =
        await this.dynamoService.getAppointmentsByNumberID(numberId);

      // 2. Transformar para el Frontend (FullCalendar)
      const formattedAppointments = rawAppointments.map((appt: any) => {
        const parts = appt.SK.split('#');
        const datePart = parts[1];
        const isoDate = datePart ? datePart.replace(' ', 'T') + ':00' : null;

        return {
          id: appt.googleEventId || appt.SK,
          title: appt.title,
          date: isoDate,
          professionalId: appt.professionalId || 'any_professional',
          userNumber: appt.userNumber,
          guestEmail: appt.guestEmail,
          userName: appt.userName || '',
          meetingLink: appt.meetingLink || '',
        };
      });
      return formattedAppointments.filter((a) => a.date !== null);
    } catch (error) {
      this.logger.error(
        `Error inesperado obteniendo eventos para ${numberId}`,
        error,
      );
      return [];
    }
  }
}
