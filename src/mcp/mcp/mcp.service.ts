// src/mcp/mcp.service.ts
import { Injectable } from '@nestjs/common';
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
        title: 'Consultar calendario',
        description:
          'Muestra tus eventos programados y los huecos libres de lunes a viernes entre 08:00 y 17:00 (excluye 13:00–14:00).',
        inputSchema: {
          date: z
            .string()
            .describe(
              'The date to get calendar events for, in YYYY-MM-DD format.',
            ),
        },
      },
      async ({ date }) => {
        const events = await this.calendarService.getEvents(date);
        const businessSlots = [
          ...[8, 9, 10, 11, 12].map(
            (h) => `${h.toString().padStart(2, '0')}:00`,
          ),
          ...[14, 15, 16].map((h) => `${h}:00`),
        ];
        const busySlots = events.map((e) => e.start);
        const freeSlots = businessSlots.filter(
          (slot) => !busySlots.includes(slot),
        );

        if (freeSlots.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Lo siento, no hay franjas disponibles el ${date} entre las 08:00 y 17:00.`,
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
                  .map(
                    (h) =>
                      `• ${h}–${(parseInt(h) + 1).toString().padStart(2, '0')}:00`,
                  )
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
