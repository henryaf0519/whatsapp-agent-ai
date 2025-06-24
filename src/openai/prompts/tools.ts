import { ChatCompletionTool } from 'openai/resources/chat/completions';
// --- DEFINICIONES DE HERRAMIENTAS EN FORMATO OPENAI ---
export const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'Gmail_Send',
      description:
        'Envía un nuevo correo electrónico a un destinatario específico con un asunto y un cuerpo. La IA debe redactar un cuerpo de correo profesional, completo y atractivo basado en la intención del usuario. Si se proporciona, usa el nombre del destinatario para personalizar el saludo.',
      parameters: {
        type: 'object',
        properties: {
          recipient: {
            type: 'string',
            description:
              "La dirección de correo electrónico del destinatario (ej. 'ejemplo@dominio.com').",
          },
          subject: {
            type: 'string',
            description: 'El asunto del correo electrónico.',
          },
          body: {
            type: 'string',
            description:
              "El contenido principal del correo electrónico. DEBE ser una versión profesional, completa, bien estructurada y persuasiva del mensaje del usuario. La IA debe expandir la intención del usuario en un correo bien redactado, incluyendo un saludo y una despedida adecuados. Por ejemplo, si el usuario dice 'enviar invitación', la IA debe redactar la invitación completa y atractiva.",
          },
          recipient_name: {
            type: 'string',
            description:
              'El nombre del destinatario del correo. Opcional. Si se proporciona, úsalo en el saludo del cuerpo.',
          },
        },
        required: ['recipient', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Calendar_Set',
      description: 'Agenda una nueva reunión o cita en el calendario.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              "La fecha de la reunión en formato AAAA-MM-DD. Debe ser una fecha concreta (ej. '2025-07-15'), no relativa.",
          },
          time: {
            type: 'string',
            description: 'La hora de la reunión en formato HH:MM (24 horas).',
          },
          title: {
            type: 'string',
            description: 'El título o descripción breve de la reunión/cita.',
          },
          duration_minutes: {
            type: 'number',
            description:
              'La duración de la reunión en minutos. Por defecto es 60 si no se especifica.',
          },
        },
        required: ['date', 'time', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Calendar_Get',
      description:
        'Consulta los eventos o citas en el calendario para una fecha específica.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              "La fecha a consultar en formato AAAA-MM-DD. Por defecto es la fecha actual ('today') si no se especifica. Debe ser una fecha concreta (ej. '2025-07-15'), no relativa.",
          },
        },
      },
    },
  },
];
