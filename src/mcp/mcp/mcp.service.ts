import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EmailService } from '../../email/email.service';
import { CalendarService } from '../../calendar/calendar.service';
import { readFileSync } from 'fs';
import { join } from 'path';

interface ToolMeta {
  name: string;
  description: string;
  inputKeys: string[];
}

@Injectable()
export class McpService {
  private readonly toolsMeta: ToolMeta[] = [
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
    const prompt: { title: string; description: string; prompt: string } =
      JSON.parse(
        readFileSync(join(__dirname, '../../../promptVentas.json'), 'utf8'),
      );
    const server = new McpServer({
      name: 'nestjs-mcp',
      version: '1.0.0',
    });

    // Registrar Gmail_Send
    server.registerTool(
      'Gmail_Send',
      {
        title: 'Enviar email',
        description: this.toolsMeta[0].description,
        inputSchema: {
          recipient: z.string().email(),
          subject: z.string(),
          body: z.string(),
          recipient_name: z.string().optional(),
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

    // Registrar Calendar_Set
    server.registerTool(
      'Calendar_Set',
      {
        title: 'Agendar cita',
        description: this.toolsMeta[1].description,
        inputSchema: {
          date: z.string(),
          time: z.string(),
          title: z.string(),
          duration_minutes: z.number().optional(),
          attendees: z.array(z.string().email()).optional(),
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

    // Registrar Calendar_Get
    server.registerTool(
      'Calendar_Get',
      {
        title: 'Consultar calendario',
        description:
          'Muestra tus eventos programados y los huecos libres de lunes a viernes entre 08:00 y 17:00 (excluye 13:00–14:00).',
        inputSchema: {
          date: z.string(),
        },
      },
      async ({ date }) => {
        // Lógica de seguridad: solo devuelve eventos del email proporcionado
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
                      `• ${h}–${(parseInt(h) + 1)
                        .toString()
                        .padStart(2, '0')}:00`,
                  )
                  .join('\n') +
                `\n\nPor favor, indícame qué hora te va bien.`,
            },
          ],
        };
      },
    );

    server.registerTool(
      'Calendar_Update',
      {
        title: 'Modificar evento',
        description:
          'Modifica un evento del día en el que tú (cliente) figuras como asistente.',
        inputSchema: {
          date: z.string(), // "YYYY-MM-DD"
          client_email: z.string().email(), // email del cliente (debe coincidir con un attendee)
          search_summary: z.string().optional(), // fragmento del título
          time: z.string().optional(),
          title: z.string().optional(),
          duration_minutes: z.number().optional(),
          attendees: z.array(z.string().email()).optional(),
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
        // 1) Obtengo eventos donde el cliente es attendee
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

        // 2) Busco el que coincida con el fragmento de título
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

        // 3) Modifico usando el ID interno
        await this.calendarService.updateEvent(client_email, {
          date,
          time,
          title,
          durationMinutes: duration_minutes,
          attendees,
          search_summary: '',
        });

        // 4) Confirmación al cliente
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
    // Prompt de ruteo
    server.registerPrompt(
      'route',
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: { userInput: z.string() },
      },
      ({ userInput }) => {
        const manifest = this.toolsMeta
          .map(
            (t) => `• ${t.name}(${t.inputKeys.join(', ')}): ${t.description}`,
          )
          .join('\n');

        const systemText = prompt.prompt
          .replace('{{manifest}}', manifest)
          .trim();

        const messages = [
          {
            role: 'assistant' as const,
            content: { type: 'text' as const, text: systemText },
          },
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: userInput },
          },
        ];

        return {
          description: 'Prompt para decidir qué herramienta usar',
          messages,
        };
      },
    );

    return server;
  }
}
