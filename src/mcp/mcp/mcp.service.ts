import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EmailService } from '../../email/email.service';
import { CalendarService } from '../../calendar/calendar.service';

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
          'Lista tus eventos programados en una fecha. **Requiere** user_email para validar identidad.',
        inputSchema: {
          date: z.string(), // "YYYY-MM-DD"
          user_email: z.string().email(), // correo del cliente
        },
      },
      async ({ date, user_email }) => {
        // Lógica de seguridad: solo devuelve eventos del email proporcionado
        const events = await this.calendarService.getEvents(date, user_email);
        if (events.length === 0) {
          return {
            content: [{ type: 'text', text: `No tienes eventos el ${date}.` }],
          };
        }
        // Formatear lista de eventos
        const lines = events.map((e) => `• ${e.start} - ${e.summary}`);
        return {
          content: [
            {
              type: 'text',
              text: `Tus eventos para ${date}:\n` + lines.join('\n'),
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
        const match = events.find((e) =>
          e.summary.toLowerCase().includes(search_summary.toLowerCase()),
        );
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
        title: 'Decidir herramienta',
        description:
          'Selecciona Gmail_Send o Calendar_Set o Calendar_Get o Calendar_Update o pregunta datos faltantes.',
        argsSchema: { userInput: z.string() },
      },
      ({ userInput }) => {
        const manifest = this.toolsMeta
          .map(
            (t) => `• ${t.name}(${t.inputKeys.join(', ')}): ${t.description}`,
          )
          .join('\n');
        const systemText = `
          Eres un asistente que puede usar estas herramientas:
          ${manifest}

          1 Si el usuario ha dado **todos** los datos** requeridos para una herramienta:
            Para **Gmail_Send**: **redacta un correo profesional, completo y persuasivo** partiendo de la intención o texto breve que te proporcionó. **No repitas** literalmente lo que escribió; en su lugar:
              • Elige un saludo atractivo.  
              • Escribe un cuerpo bien estructurado que amplíe y mejore su idea.  
              • Cierra con una despedida apropiada.  
            Luego responde **solo** con la llamada JSON-RPC, por ejemplo:
          
          {"jsonrpc":"2.0","method":"Gmail_Send","params":{…}}
          

          2 Si **faltan** datos (asunto, fecha, título, etc.), 
          Para **Calendar_Get**:**Por favor, indícame tu correo electrónico para validar tu identidad.**
          responde en texto de forma profesional y amable **solicitando únicamente** lo que hace falta (p.ej. “Por favor indícame el asunto del correo”).
          
          3 Para **Calendar_Update** (modificar una cita existente):
          - Necesito **fecha**, **fragmento del título** y **tu correo** (como asistente).
          - Si falta alguno, **pregunta solo** por ese dato:
            • Si falta correo: “Por favor, indícame tu correo electrónico con el que fuiste invitado.”
            • Si falta fecha: “¿En qué fecha está la cita que deseas modificar?”
            • Si falta fragmento de título: “¿Cuál es el título o una parte del título de la cita?”
          - Una vez tengas esos tres, **y opcionalmente** los campos a cambiar (hora, nuevo título, duración o asistentes), **responde sólo** con la llamada JSON-RPC, por ejemplo:

        {"jsonrpc":"2.0","method":"Calendar_Update","params":{
          "date":"2025-07-15",
          "client_email":"cliente@ejemplo.com",
          "search_summary":"revisión de proyecto",
          "time":"10:00",
          "title":"Revisión detalle proyecto",
          "duration_minutes":45
        }}


          4 **Nunca** combines JSON-RPC y conversación en una misma respuesta.
          `.trim();

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
