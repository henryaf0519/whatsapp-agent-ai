import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
export interface FormattedCalendarEvent {
  start: string; // HH:MM
  end: string; // HH:MM
  title: string;
}
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

  // Dentro de tu clase CalendarService en src/calendar/calendar.service.ts

  async getEvents(date: string): Promise<FormattedCalendarEvent[]> {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.logger.error('Fecha inválida proporcionada');
      throw new ForbiddenException('Fecha inválida proporcionada');
    }

    const resToken = await this.oauth2Client.getAccessToken();
    const token = resToken.token;
    if (!token) {
      this.logger.error('No se pudo obtener access token');
      throw new InternalServerErrorException('Error obteniendo access token');
    }
    const startOfDay = new Date(`${date}T00:00:00`); // Crea fecha en la zona horaria local del servidor
    const endOfDay = new Date(`${date}T23:59:59`); // Crea fecha en la zona horaria local del servidor

    const timeMin = startOfDay.toISOString(); // Convierte a ISO string (generalmente UTC)
    const timeMax = endOfDay.toISOString(); // Convierte a ISO string (generalmente UTC)
    const googleCalendarTimeZone = 'America/Bogota';

    const url = `${this.baseUrl}/calendars/${this.calendarId}/events`;
    try {
      this.logger.debug(
        `[getEvents] Consultando eventos para la fecha: ${date} con timeMin: ${timeMin} y timeMax: ${timeMax}`,
      );
      const { data } = await axios.get<{
        items: Array<{
          start: { dateTime?: string; date?: string };
          end: { dateTime?: string; date?: string };
          summary?: string;
        }>;
      }>(url, {
        params: {
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          timeZone: googleCalendarTimeZone,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      this.logger.debug(
        `[getEvents] Respuesta RAW de Google Calendar: ${JSON.stringify(data, null, 2)}`,
      );

      const items = data.items || [];
      const formattedEvents: FormattedCalendarEvent[] = [];
      if (items.length === 0) {
        this.logger.log(
          `[CalendarService] No se encontraron eventos para ${date} después de la consulta API.`,
        );
      }

      for (const e of items) {
        const startDateTime = e.start?.dateTime;
        const endDateTime = e.end?.dateTime;
        const summary = e.summary || '(Sin título)';

        if (startDateTime && endDateTime) {
          // Parseamos las fechas que vienen de Google (ya estarán en la zona horaria correcta o ISO)
          const startDate = new Date(startDateTime);
          const endDate = new Date(endDateTime);

          // Formateamos a HH:MM usando la zona horaria 'es-CO' para consistencia
          const formattedStart = startDate.toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          const formattedEnd = endDate.toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });

          formattedEvents.push({
            start: formattedStart,
            end: formattedEnd,
            title: summary,
          });
          this.logger.log(
            `  - Evento Formateado: ${summary}, Inicio: ${formattedStart}, Fin: ${formattedEnd}`,
          );
        } else if (e.start?.date && e.end?.date) {
          // Eventos de día completo (si es que quieres que bloqueen todo el día)
          this.logger.log(
            `  - Evento de día completo detectado: ${summary} el ${e.start.date}`,
          );
          // Para la lógica de "huecos", un evento de día completo significa que el día está ocupado
          formattedEvents.push({
            start: '00:00',
            end: '23:59',
            title: summary,
          });
        }
      }
      return formattedEvents;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.error(
          `Error al consultar eventos (${err.response?.status}): ${JSON.stringify(err.response?.data)}`,
          err.stack, // Añadimos el stack trace para mejor depuración
        );
        if (err.response?.status === 401 || err.response?.status === 403) {
          throw new ForbiddenException(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            `Problema de autenticación/permisos con Google Calendar: ${err.response?.data?.error?.message || 'Token inválido o permisos insuficientes'}`,
          );
        }
      }
      this.logger.error('Error inesperado consultando eventos', err);
      throw new InternalServerErrorException(
        'Error inesperado consultando eventos',
      );
    }
  }
  async updateEvent(
    clientEmail: string,
    updates: {
      date: string;
      search_summary: string;
      time?: string;
      title?: string;
      durationMinutes?: number;
      attendees?: string[];
    },
  ): Promise<unknown> {
    const { date, search_summary, time, title, durationMinutes, attendees } =
      updates;

    // 1) Obtener token
    const { token } = await this.oauth2Client.getAccessToken();
    if (!token) {
      this.logger.error('Error obteniendo access token');
      throw new InternalServerErrorException(
        'No se pudo obtener un token de acceso',
      );
    }

    // 2) Rango de día completo
    const timeMin = new Date(`${date}T00:00:00-05:00`).toISOString();
    const timeMax = new Date(`${date}T23:59:59-05:00`).toISOString();

    // 3) Traer todos los eventos del día
    const { data } = await axios.get<{ items: any[] }>(
      `${this.baseUrl}/calendars/${this.calendarId}/events`,
      {
        params: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime' },
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    // 4) Filtrar sólo los donde clientEmail es attendee
    const myEvents = (data.items || []).filter(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'attendees' in e &&
        Array.isArray((e as { attendees?: any[] }).attendees) &&
        ((e as { attendees?: any[] }).attendees as any[]).some(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          (a: any) => a.email === clientEmail,
        ),
    );

    if (myEvents.length === 0) {
      throw new ForbiddenException(`No tienes citas el ${date} como invitado.`);
    }

    // 5) Buscar por fragmento de título
    const match = myEvents.find(
      (e: { summary?: string }) =>
        typeof e.summary === 'string' &&
        e.summary.toLowerCase().includes(search_summary.toLowerCase()),
    ) as { id: string; summary?: string } | undefined;
    if (!match) {
      const titles = myEvents
        .map((e: { summary?: string }) =>
          typeof e.summary === 'string' ? e.summary : '(Sin título)',
        )
        .join('\n• ');
      throw new ForbiddenException(
        `Encontré estas citas el ${date}:\n• ${titles}\nPero ninguna coincide con "${search_summary}".`,
      );
    }

    const eventId: string = match.id;
    this.logger.log(`Modificando evento ${eventId} (${match.summary})`);

    // 6) Obtener detalles actuales para calcular nuevos start/end
    const oldEvent = await axios
      .get<{ start: { dateTime: string }; end: { dateTime: string } }>(
        `${this.baseUrl}/calendars/${this.calendarId}/events/${eventId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      .then((r) => r.data);

    // 7) Construir el body del PATCH
    const body: {
      summary?: string;
      start?: { dateTime: string };
      end?: { dateTime: string };
      attendees?: { email: string }[];
    } = {};
    if (title) body.summary = title;

    if (time || durationMinutes) {
      const startOld = new Date(oldEvent.start.dateTime);
      const dateStr = date;
      const timeStr = time ?? startOld.toISOString().slice(11, 16);
      const duration =
        durationMinutes != null
          ? durationMinutes
          : (new Date(oldEvent.end.dateTime).getTime() - startOld.getTime()) /
            60000;
      const newStart = new Date(`${dateStr}T${timeStr}:00-05:00`);
      body.start = { dateTime: newStart.toISOString() };
      body.end = {
        dateTime: new Date(newStart.getTime() + duration * 60000).toISOString(),
      };
    }

    if (attendees) {
      body.attendees = attendees.map((email) => ({ email }));
    }

    // 8) Enviar el PATCH
    try {
      const url = `${this.baseUrl}/calendars/${this.calendarId}/events/${eventId}?sendUpdates=all`;
      const { data: updated } = await axios.patch(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(`Evento ${eventId} modificado exitosamente`);
      return updated;
    } catch (err: any) {
      throw new InternalServerErrorException(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        `No se pudo modificar evento: ${err.response?.data?.error?.message || err.message}`,
      );
    }
  }
  async getEventsByAttendee(
    date: string,
    attendeeEmail: string,
  ): Promise<Array<{ id: string; start: string; summary: string }>> {
    // 1) Obtén token
    const { token } = await this.oauth2Client.getAccessToken();
    if (!token)
      throw new InternalServerErrorException('Error obteniendo token');

    // 2) Rango de día completo
    const timeMin = new Date(`${date}T00:00:00-05:00`).toISOString();
    const timeMax = new Date(`${date}T23:59:59-05:00`).toISOString();

    // 3) Llama a la API de Calendar
    const { data } = await axios.get<{ items: any[] }>(
      `${this.baseUrl}/calendars/${this.calendarId}/events`,
      {
        params: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime' },
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    // 4) Filtra solo los donde e.attendees incluye attendeeEmail
    const items = data.items || [];
    const filtered = items.filter(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'attendees' in e &&
        Array.isArray((e as { attendees?: any[] }).attendees) &&
        ((e as { attendees?: any[] }).attendees as any[]).some(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          (a: any) => a.email === attendeeEmail,
        ),
    );

    // 5) Mapea a id/start/summary
    return filtered.map(
      (e: {
        id: string;
        start?: { dateTime?: string; date?: string };
        summary?: string;
      }) => ({
        id: e.id,
        start: e.start?.dateTime || e.start?.date || '',
        summary: e.summary || '(Sin título)',
      }),
    );
  }
}
