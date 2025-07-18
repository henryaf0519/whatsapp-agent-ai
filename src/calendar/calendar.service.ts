import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
@Injectable()
export class CalendarService {
  private readonly calendarId: string;
  private readonly oauth2Client: OAuth2Client;
  private readonly baseUrl = 'https://www.googleapis.com/calendar/v3';
  private readonly logger = new Logger(CalendarService.name);

  constructor(private readonly config: ConfigService) {
    const clientId = this.config.get<string>('GMAIL_CLIENT_ID');
    const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET');
    const refreshToken = this.config.get<string>('GMAIL_REFRESH_TOKEN');
    const redirectUri = this.config.get<string>('GMAIL_REDIRECT_URI');
    this.calendarId = this.config.get<string>('GOOGLE_CALENDAR_ID', 'primary');

    if (!clientId || !clientSecret || !refreshToken || !redirectUri) {
      throw new Error('Faltan credenciales OAuth2 de Gmail');
    }

    this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
  }

  async createEvent(
    date: string,
    time: string,
    title: string,
    durationMinutes = 60,
    guestEmails: string[] = [],
  ): Promise<unknown> {
    const res = await this.oauth2Client.getAccessToken();
    const token = res.token;
    if (!token) {
      this.logger.error('No se pudo obtener access token');
      throw new InternalServerErrorException('Error obteniendo access token');
    }
    const start = new Date(`${date}T${time}:00-05:00`);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const body: {
      summary: string;
      start: { dateTime: string };
      end: { dateTime: string };
      attendees?: { email: string }[];
    } = {
      summary: title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
    if (guestEmails.length) {
      body.attendees = guestEmails.map((email) => ({ email }));
    }

    const url = `${this.baseUrl}/calendars/${this.calendarId}/events?sendUpdates=all`;
    try {
      const { data } = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(`Evento creado`);
      return data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.error(
          `Google Calendar API error ${err.response?.status}`,
          JSON.stringify(err.response?.data),
        );
        throw new InternalServerErrorException(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          `No se pudo crear evento (${err.response?.status}): ${err.response?.data?.error?.message || err.message}`,
        );
      }
      this.logger.error('Error inesperado creando evento', err);
      throw new InternalServerErrorException('Error inesperado creando evento');
    }
  }

}
