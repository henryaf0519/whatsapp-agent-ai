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
    /* server.registerTool(
      'Calendar_Get',
      {
        title: 'Consultar calendario',
        description: this.toolsMeta[2].description,
        inputSchema: { date: z.string().optional() },
      },
      async ({ date }) => {
        const events = await this.calendarService.getEvents(
          date || new Date().toISOString().slice(0, 10),
        );
        const text = events.length
          ? events.map((e) => `${e.start} – ${e.summary}`).join('\n')
          : 'No hay eventos.';
        return { content: [{ type: 'text', text }] };
      },
    );*/

    // Prompt de ruteo
    server.registerPrompt(
      'route',
      {
        title: 'Decidir herramienta',
        description:
          'Selecciona Gmail_Send o Calendar_Set, o pregunta datos faltantes.',
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
          

          2 Si **faltan** datos (asunto, fecha, título, etc.), responde en texto de forma profesional y amable **solicitando únicamente** lo que hace falta (p.ej. “Por favor indícame el asunto del correo”).  

          3 **Nunca** combines JSON-RPC y conversación en una misma respuesta.
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
