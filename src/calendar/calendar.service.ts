/* eslint-disable @typescript-eslint/no-unsafe-return */
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
      body.attendees = guestEmails.map((email) => ({
        email: email.toString().trim().toLowerCase(),
      }));
    }

    this.logger.log('body calendar: ' + JSON.stringify(body));

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

  async createAppointmentFromDashboard(
    numberId: string,
    body: {
      date: string;
      time: string;
      stylistId: string;
      stylistName: string;
      clientEmail: string;
      clientName: string;
      clientPhone: string;
    },
  ) {
    const {
      date,
      time,
      stylistId,
      stylistName,
      clientEmail,
      clientName,
      clientPhone,
    } = body;

    const duration = 60;

    // 1. FORMATEO EXACTO DEL TÍTULO
    // Ejemplo: "Cita Bloom Beauty Salon - Henry (Prof: Over Otalora)"
    const title = `Cita Bloom Beauty Salon - ${clientName} (Prof: ${stylistName})`;

    // 2. FORMATEO DEL TELÉFONO (userNumber)
    // Debe quedar como "573196372542" (sin el +)
    let userNumber = clientPhone.replace(/\D/g, ''); // Quita espacios, +, guiones
    if (userNumber.startsWith('57') && userNumber.length > 10) {
      // Ya tiene el 57, lo dejamos así
    } else if (userNumber.length === 10) {
      // Es un cel colombiano sin indicativo, le ponemos el 57
      userNumber = `57${userNumber}`;
    }
    // Si no cumple ninguna, se va como está (ej. número internacional)

    try {
      // 3. Crear evento en Google Calendar
      const googleEvent = await this.createEvent(
        numberId,
        date,
        time,
        title,
        duration,
        [clientEmail],
      );

      const meetingLink = googleEvent.hangoutLink || '';
      const googleEventId = googleEvent.id;

      // 4. PREPARAR EL SLOT
      // En tu ejemplo de Dynamo: SLOT#2025-12-02 18:00#over_otalora
      // Normalmente 'saveAppointment' recibe la fecha base ("2025-12-02 18:00")
      // y el professionalId ("over_otalora") y los une.
      // Pasamos la fecha base limpia.
      const selectedSlot = `${date} ${time}`;

      this.logger.log(
        `Guardando cita idéntica a WA. Slot: ${selectedSlot}, User: ${userNumber}`,
      );

      // 5. GUARDAR EN DYNAMO
      await this.dynamoService.saveAppointment(
        numberId, // PK (APPT#...) lo maneja el servicio internamente con este ID
        selectedSlot, // Fecha base para el SK
        userNumber, // Teléfono con formato 57...
        title,
        duration,
        clientEmail,
        googleEventId,
        stylistId, // "over_otalora" (Se usará para armar el SK final)
        clientName, // "Henry"
        meetingLink,
      );

      return {
        success: true,
        message: 'Cita creada correctamente',
        googleEvent,
      };
    } catch (error) {
      this.logger.error('Error creando cita desde Dashboard', error);
      throw new InternalServerErrorException('Error al procesar la cita');
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
