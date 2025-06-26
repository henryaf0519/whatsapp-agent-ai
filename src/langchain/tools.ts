// src/langchain/tools.ts
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Logger } from '@nestjs/common';

// Un solo cliente MCP que será compartido por todas las instancias de tus herramientas LangChain.
// Esto evita múltiples conexiones. Se conectará la primera vez que se use una herramienta.
const mcpClient = new McpClient({
  name: 'langchain-tool-mcp-client',
  version: '1.0.0',
});
const toolLogger = new Logger('LangChainTools');

// Función auxiliar para asegurar la conexión del cliente MCP
async function ensureMcpClientConnected() {
  // Always attempt to connect; the client should handle idempotency internally.
  try {
    toolLogger.warn(
      'Ensuring MCP Client is connected. Attempting to connect to http://localhost:3000/mcp...',
    );
    await mcpClient.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')),
    );
    toolLogger.log(
      'MCP Client connected successfully or was already connected.',
    );
  } catch (error) {
    toolLogger.error('Failed to connect MCP Client:', error);
    throw new Error('Could not connect to MCP Server to execute tool.');
  }
}

// --- CalendarGetTool ---
const CalendarGetToolInputSchema = z.object({
  date: z
    .string()
    .describe('The date to get calendar events for, in YYYY-MM-DD format.'),
});

export class CalendarGetTool extends StructuredTool<
  typeof CalendarGetToolInputSchema
> {
  name = 'Calendar_Get';
  description =
    'Useful for finding available time slots and planned events in the calendar on a specific date. Input should be a string representing the date in YYYY-MM-DD format, for example "2025-06-25". It considers working hours from 08:00 to 17:00, excluding 13:00-14:00 for lunch.';

  schema = CalendarGetToolInputSchema;

  async _call(input: z.infer<typeof this.schema>) {
    toolLogger.log(
      `LangChain agent calling Calendar_Get via MCP with date: ${input.date}`,
    );
    await ensureMcpClientConnected(); // Asegura que el cliente MCP esté conectado
    const result = await mcpClient.callTool({
      name: 'Calendar_Get',
      arguments: { date: input.date },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = result.content?.[0]?.text;
    toolLogger.log(`MCP Calendar_Get response for agent: ${content}`);
    return typeof content === 'string'
      ? content
      : 'No se pudo obtener la información del calendario.';
  }
}

// --- CalendarSetTool ---
export class CalendarSetTool extends StructuredTool<
  typeof CalendarGetToolInputSchema
> {
  name = 'Calendar_Set';
  description =
    'Use this to schedule a new 60-minute appointment on the calendar. Input must be a JSON object with "date" (YYYY-MM-DD), "time" (HH:MM in 24-hour format), and a "title". "duration_minutes" (default 60) and "attendees" (array of emails) are optional. Example: \'{"date": "2025-06-26", "time": "10:30", "title": "Meeting with Client", "attendees": ["client@example.com"]}\'.';

  schema = z.object({
    date: z
      .string()
      .describe('The date for the appointment in YYYY-MM-DD format.'),
    time: z
      .string()
      .describe('The time for the appointment in HH:MM (24-hour) format.'),
    title: z.string().describe('The title of the appointment.'),
    duration_minutes: z
      .number()
      .optional()
      .describe('The duration of the appointment in minutes (default 60).'),
    attendees: z
      .array(z.string().email())
      .optional()
      .describe('An optional array of attendee email addresses.'),
  });

  async _call(input: z.infer<typeof this.schema>) {
    toolLogger.log(
      `LangChain agent calling Calendar_Set via MCP with input: ${JSON.stringify(input)}`,
    );
    await ensureMcpClientConnected();
    const result = await mcpClient.callTool({
      name: 'Calendar_Set',
      arguments: { ...input },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = result.content?.[0]?.text;
    toolLogger.log(`MCP Calendar_Set response for agent: ${content}`);
    return typeof content === 'string'
      ? content
      : 'No se pudo agendar la cita.';
  }
}

// --- CalendarUpdateTool ---
export const CalendarUpdateToolInputSchema = z.object({
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
});

export class CalendarUpdateTool extends StructuredTool<
  typeof CalendarUpdateToolInputSchema
> {
  name = 'Calendar_Update';
  description =
    'Useful for modifying an existing calendar appointment. Input must be a JSON object containing the date (YYYY-MM-DD) of the event, the client\'s email, and optionally a search summary (fragment of title) to find the event. You can update "time" (HH:MM), "title", "duration_minutes", or "attendees". Example: \'{"date": "2025-06-25", "client_email": "user@example.com", "search_summary": "Daily Standup", "time": "10:30"}\'.';

  schema = z.object({
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
  });

  async _call(input: z.infer<typeof this.schema>) {
    toolLogger.log(
      `LangChain agent calling Calendar_Update via MCP with input: ${JSON.stringify(input)}`,
    );
    await ensureMcpClientConnected();
    const result = await mcpClient.callTool({
      name: 'Calendar_Update',
      arguments: { ...input },
    });
    const content = result.content?.[0]?.text;
    toolLogger.log(`MCP Calendar_Update response for agent: ${content}`);
    return content || 'No se pudo modificar la cita.';
  }
}

// --- GmailSendTool ---
export const GmailSendToolInputSchema = z.object({
  recipient: z.string().email().describe('The email address of the recipient.'),
  subject: z.string().describe('The subject line of the email.'),
  body: z.string().describe('The main content of the email.'),
  recipient_name: z
    .string()
    .optional()
    .describe('The optional name of the recipient.'),
});

export class GmailSendTool extends StructuredTool<
  typeof GmailSendToolInputSchema
> {
  name = 'Gmail_Send';
  description =
    'Use this to send an email. Input must be a JSON object with the recipient\'s email address, the subject, and the body of the email. "recipient_name" is optional. Example: \'{"recipient": "john.doe@example.com", "subject": "Meeting Reminder", "body": "Don\'t forget our meeting tomorrow!", "recipient_name": "John Doe"}\'.';

  schema = GmailSendToolInputSchema;

  async _call(input: z.infer<typeof this.schema>) {
    toolLogger.log(
      `LangChain agent calling Gmail_Send via MCP with input: ${JSON.stringify(input)}`,
    );
    await ensureMcpClientConnected();
    const result = await mcpClient.callTool({
      name: 'Gmail_Send',
      arguments: { ...input },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = result.content?.[0]?.text;
    toolLogger.log(`MCP Gmail_Send response for agent: ${content}`);
    return typeof content === 'string'
      ? content
      : 'No se pudo enviar el correo.';
  }
}
