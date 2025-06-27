// src/mcp/mcp.service.ts
import { Injectable,Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EmailService } from '../../email/email.service';
import { CalendarService } from '../../calendar/calendar.service';

// Mantén esta parte, define la estructura de las herramientas para McpServer
interface ToolMeta {
  name: string;
  description: string;
  inputKeys: string[];
}

@Injectable()
export class McpService {
  private readonly toolsMeta: ToolMeta[] = [
    // Asegúrate de que las descripciones aquí son buenas
    {
      name: 'Gmail_Send',
      description: 'Envía un correo con asunto, cuerpo y destinatario.',
      inputKeys: ['recipient', 'subject', 'body', 'recipient_name'],
    },
    {
      name: 'Calendar_Set',
      description: 'Crea un evento en Google Calendar.',
      inputKeys: ['date', 'time', 'title', 'duration_minutes', 'attendees'],
    },
    {
      name: 'Calendar_Get',
      description: 'Lista eventos de una fecha dada.',
      inputKeys: ['date'],
    },
    {
      name: 'Calendar_Update',
      description: 'Modifica un evento existente en el calendario.',
      inputKeys: [
        'date',
        'time',
        'title',
        'duration_minutes',
        'attendees',
        'client_email',
        'search_summary',
      ],
    },
  ];
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly calendarService: CalendarService,
  ) {}

  getServer(): McpServer {
    const server = new McpServer({
      name: 'nestjs-mcp',
      version: '1.0.0',
    });

    // Registra tus herramientas con descripciones claras para el LLM (aunque LangChain las tendrá también)
    // Gmail_Send
    server.registerTool(
      'Gmail_Send',
      {
        title: 'Enviar email',
        description:
          'Envía un correo electrónico. Requiere el email del destinatario, un asunto y el cuerpo del mensaje.', // Descripción clara para quien use el servidor MCP
        inputSchema: {
          recipient: z
            .string()
            .email()
            .describe('The email address of the recipient.'),
          subject: z.string().describe('The subject line of the email.'),
          body: z.string().describe('The main content of the email.'),
          recipient_name: z
            .string()
            .optional()
            .describe('The optional name of the recipient.'),
        },
      },
      async ({ recipient, subject, body, recipient_name }) => {
        await this.emailService.sendEmail(
          recipient,
          subject,
          body,
          recipient_name,
        );
        return { content: [{ type: 'text', text: 'Correo enviado ✅' }] };
      },
    );

    // Calendar_Set
    server.registerTool(
      'Calendar_Set',
      {
        title: 'Agendar cita',
        description: 'Crea un evento en Google Calendar de 60 minutos.',
        inputSchema: {
          date: z
            .string()
            .describe('The date for the appointment in YYYY-MM-DD format.'),
          time: z
            .string()
            .describe(
              'The time for the appointment in HH:MM (24-hour) format.',
            ),
          title: z.string().describe('The title of the appointment.'),
          duration_minutes: z
            .number()
            .optional()
            .describe(
              'The duration of the appointment in minutes (default 60).',
            ),
          attendees: z
            .array(z.string().email())
            .optional()
            .describe('An array of attendee email addresses.'),
        },
      },
      async ({ date, time, title, duration_minutes, attendees }) => {
        await this.calendarService.createEvent(
          date,
          time,
          title,
          duration_minutes || 60,
          attendees || [],
        );
        return { content: [{ type: 'text', text: 'Evento agendado 📅' }] };
      },
    );

    // Calendar_Get
    server.registerTool(
      'Calendar_Get',
      {
        title: 'Consultar Horarios Disponibles en Calendario',
        description:
          'Muestra los **rangos de tiempo disponibles** en el calendario de lunes a viernes entre 08:00 y 17:00 (excluyendo la hora del almuerzo de 13:00 a 14:00). Devuelve una lista de los horarios exactos en los que se pueden agendar nuevas citas.',
        inputSchema: {
          date: z
            .string()
            .describe(
              'La fecha específica en formato YYYY-MM-DD para la cual se desean consultar los horarios disponibles.',
            ),
        },
      },
      async ({ date }) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return {
            content: [
              {
                type: 'text',
                text: `Por favor, proporciona una fecha válida en formato YYYY-MM-DD para consultar los horarios disponibles.`,
              },
            ],
          };
        }

        const events = await this.calendarService.getEvents(date);
        const busyIntervals = events.map((event) => {
          // Si event.end no existe, asumimos que el evento dura 1 hora
          const [startHour, startMinute] = event.start.split(':').map(Number);
          let endHour: number, endMinute: number;
          if ('end' in event && typeof event.end === 'string') {
            [endHour, endMinute] = event.end.split(':').map(Number);
          } else {
            // Asume duración de 1 hora si no hay 'end'
            endHour = startHour + 1;
            endMinute = startMinute;
          }
          return {
            startHour,
            startMinute,
            endHour,
            endMinute,
          };
        });

        const freeSlots: { start: string; end: string }[] = [];
        // Iterar sobre cada hora de negocio (slots de 1 hora)
        for (let h = 8; h < 17; h++) {
          if (h === 13) continue; // Excluir la hora del almuerzo

          const slotStartHour = h;
          const slotEndHour = h + 1; // El slot de 8:00 a 9:00, termina en la hora 9.

          let isFree = true;
          for (const busy of busyIntervals) {
            const slotStartMinutes = slotStartHour * 60;
            const slotEndMinutes = slotEndHour * 60;
            const busyStartMinutes = busy.startHour * 60 + busy.startMinute;
            const busyEndMinutes = busy.endHour * 60 + busy.endMinute;
            if (
              slotStartMinutes < busyEndMinutes &&
              slotEndMinutes > busyStartMinutes
            ) {
              isFree = false;
              break;
            }
          }
          if (isFree) {
            freeSlots.push({
              start: `${slotStartHour.toString().padStart(2, '0')}:00`,
              end: `${slotEndHour.toString().padStart(2, '0')}:00`,
            });
          }
        }
        if (freeSlots.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Lo siento, no hay horarios disponibles para agendar el ${date} entre las 08:00 y 17:00. Por favor, ¿podrías elegir otra fecha?`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text',
              text:
                `Estos son los horarios libres el ${date}:\n` +
                freeSlots
                  .map((slot) => `• ${slot.start} - ${slot.end}`)
                  .join('\n') +
                `\n\nPor favor, indícame qué hora te va bien.`,
            },
          ],
        };
      },
    );

    // Calendar_Update
    server.registerTool(
      'Calendar_Update',
      {
        title: 'Modificar evento',
        description:
          'Modifica un evento del día en el que tú (cliente) figuras como asistente. Necesitas la fecha, el email del cliente, y un resumen para buscar el evento.',
        inputSchema: {
          date: z
            .string()
            .describe('The date of the event to modify in YYYY-MM-DD format.'),
          client_email: z
            .string()
            .email()
            .describe(
              'The email of the client attending the event to be modified. This is mandatory to find the event.',
            ),
          search_summary: z
            .string()
            .optional()
            .describe(
              'A fragment of the event title to uniquely identify the event. If multiple matches, it will list options.',
            ),
          time: z
            .string()
            .optional()
            .describe('The new time for the event in HH:MM (24-hour) format.'),
          title: z.string().optional().describe('The new title for the event.'),
          duration_minutes: z
            .number()
            .optional()
            .describe('The new duration of the event in minutes.'),
          attendees: z
            .array(z.string().email())
            .optional()
            .describe('The new list of attendee email addresses.'),
        },
      },
      async ({
        date,
        client_email,
        search_summary,
        time,
        title,
        duration_minutes,
        attendees,
      }) => {
        console.log(
          `Modificar evento: ${date}, ${client_email}, ${search_summary}, ${time}, ${title}, ${duration_minutes}`,
        );
        const events = await this.calendarService.getEventsByAttendee(
          date,
          client_email,
        );
        console.log(
          `Eventos encontrados para ${client_email} el ${date}: ${events.length}`,
        );

        if (events.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No encontré ninguna cita el ${date} donde estés como invitado (${client_email}).`,
              },
            ],
          };
        }

        const match = search_summary
          ? events.find((e) =>
              e.summary.toLowerCase().includes(search_summary.toLowerCase()),
            )
          : undefined;
        if (!match) {
          const list = events
            .map((e) => `• ${e.summary} a las ${e.start}`)
            .join('\n');
          return {
            content: [
              {
                type: 'text',
                text: `Vi estos eventos el ${date}:\n${list}\n\n¿Cuál deseas modificar? Por favor, escribe el título exacto o un fragmento más preciso.`,
              },
            ],
          };
        }

        await this.calendarService.updateEvent(client_email, {
          date,
          time,
          title,
          durationMinutes: duration_minutes,
          attendees,
          search_summary: '',
        });

        return {
          content: [
            {
              type: 'text',
              text: `He modificado tu cita "${match.summary}" correctamente ✅`,
            },
          ],
        };
      },
    );

    // El prompt 'route' en McpService ya no será usado por LangChain para el agent.
    // Solo si otra parte de tu sistema lo usa, mantenlo.
    // server.registerPrompt('route', { ... });

    return server;
  }
}
