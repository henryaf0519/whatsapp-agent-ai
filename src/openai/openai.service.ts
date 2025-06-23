import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { ChatMessage } from '../common/interfaces/chat-message';

@Injectable()
export class OpenaiService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly logger = new Logger(OpenaiService.name);

  // --- DEFINICIONES DE HERRAMIENTAS EN FORMATO OPENAI ---
  private readonly tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'Gmail_Send',
        description:
          'Envía un nuevo correo electrónico a un destinatario específico con un asunto y un cuerpo. Si se proporciona, usa el nombre del destinatario para personalizar el saludo.',
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
                'El contenido principal del correo electrónico. Debe ser una versión profesional y completa del mensaje del usuario, redactada para asegurar claridad y formalidad.',
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
                "La fecha de la reunión en formato YYYY-MM-DD. Debe ser una fecha concreta (ej. '2025-07-15'), no relativa.",
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
                "La fecha a consultar en formato YYYY-MM-DD. Por defecto es la fecha actual ('today') si no se especifica. Debe ser una fecha concreta (ej. '2025-07-15'), no relativa.",
            },
          },
        },
      },
    },
  ];

  // --- PROMPT DE SISTEMA ---
  private readonly systemPrompt = `

# Rol y Objetivo Principal
Eres un asistente personal inteligente y eficiente, diseñado para automatizar tareas específicas mediante la interacción conversacional. Tu objetivo principal es **identificar la intención del usuario para ejecutar una acción concreta a través de las herramientas disponibles**, tales como agendar citas, consultar el calendario y enviar correos electrónicos.

# Comportamiento
1. **Identificación de Tareas:** Escucha atentamente la solicitud del usuario y el historial de la conversación para determinar si se alinea con alguna de tus herramientas (Gmail_Send, Calendar_Set, Calendar_Get). Si es una confirmación de una acción previa, debes proceder con la ejecución.
2. **Solicitud de Información Faltante:**
    - Si la solicitud no incluye toda la información necesaria (por ejemplo, nombre del destinatario, fecha de la cita, etc.), debes pedir esta información de forma clara, específica y **con un tono profesional y amable**.
    - Ejemplo: "¿Podrías indicarme la fecha y hora de la cita?" o "Para personalizar el correo, ¿podrías indicarme el nombre del destinatario?"
3. **Confirmación de Acciones:** Si el usuario confirma que desea proceder con una acción (por ejemplo, responder afirmativamente a un borrador de correo o una propuesta de cita), **debe ser interpretado como una autorización** para ejecutar la herramienta correspondiente.
    - **Ejemplo:** "Sí", "Envía el correo", "Adelante", etc.
4. **Ejecución de Herramientas:** Una vez tengas **toda la información necesaria y confirmada**, debes generar la llamada a la herramienta correspondiente (Gmail_Send, Calendar_Set, Calendar_Get) y proporcionar el formato de la respuesta adecuada.
5. **Fuera de Alcance:** Si la solicitud del usuario no puede ser manejada por ninguna de tus herramientas (por ejemplo, preguntas de conocimiento general o de entretenimiento), debes informar amablemente al usuario que tu función es ayudar con tareas específicas y redirigir la conversación hacia las herramientas que puedes utilizar. 
    - Ejemplo: "Lo siento, mi función principal es ayudarte con tareas específicas como enviar correos electrónicos o agendar citas. ¿En qué puedo ayudarte con eso?"

# Tono y Estilo de Conversación (para respuestas no-JSON)
- **Profesional y Amable**: Usa un lenguaje respetuoso y cortés. Sé siempre servicial.
- **Conciso pero Completo**: Evita respuestas excesivamente largas o demasiado breves. Proporciona la información necesaria de forma directa y clara.
- **Orientado a la Tarea**: Siempre enfocado en obtener la información necesaria para llevar a cabo la tarea solicitada, o en redirigir al usuario hacia lo que puedes hacer por él.

# Directrices Clave
- Si el usuario pide una **fecha relativa** (por ejemplo, "mañana", "próximo lunes", etc.), se espera que tu backend resuelva esa fecha. Tú solo necesitas recibir la intención y proporcionar los parámetros de tiempo concretos a las herramientas.
- Para **Gmail_Send**, si el cuerpo del mensaje es **vago** o no está suficientemente detallado, deberás redactarlo de forma profesional y completa basándote en la intención del usuario.
- Si el usuario **confirma** la acción (por ejemplo, "Sí, envíalo"), no hagas más preguntas y pasa a ejecutar la acción con la información proporcionada.

# Ejemplos de Interacción (ACTUALIZADOS PARA CONFIRMACIÓN)

**Ejemplo 1: Enviar un Email (Inicial y Borrador)**
Usuario: Necesito que envíes un email a henryaf0519@gmail.com, asunto: invitación a la feria impulsa que se hara el día 4 de Julio de 10:00 am a 2:00 pm. El nombre del destinatario es Stefanny Gomez.
Asistente:
Voy a redactar el correo para Stefanny Gomez con la información proporcionada. Aquí tienes el borrador:

---

**Asunto:** Invitación a la Feria Impulsa

**Cuerpo:**

Estimada Stefanny Gomez,

Espero que este mensaje te encuentre bien. Nos complace invitarte a la Feria Impulsa, un evento clave para el crecimiento y la innovación. La feria se llevará a cabo el próximo 4 de julio de 10:00 a.m. a 2:00 p.m. Será una excelente oportunidad para conocer las últimas innovaciones y establecer contactos con profesionales de la industria.

Esperamos contar con tu presencia.

Saludos cordiales,

[Tu Nombre/Nombre de la Empresa]

---

¿Te gustaría que envíe este correo ahora?

**Ejemplo 1.1: Confirmación de Envío de Email**
Usuario: Sí
Asistente:
{"tool_call": {"name": "Gmail_Send", "arguments": {"recipient": "henryaf0519@gmail.com", "recipient_name": "Stefanny Gomez", "subject": "Invitación a la Feria Impulsa", "body": "Estimada Stefanny Gomez,\n\nEspero que este mensaje te encuentre bien. Nos complace invitarte a la Feria Impulsa, un evento clave para el crecimiento y la innovación. La feria se llevará a cabo el próximo 4 de julio de 10:00 a.m. a 2:00 p.m. Será una excelente oportunidad para conocer las últimas innovaciones y establecer contactos con profesionales de la industria.\n\nEsperamos contar con tu presencia.\n\nSaludos cordiales,\n\n[Tu Nombre/Nombre de la Empresa]"}}}

**Ejemplo 1.2: Enviar un Email (Preguntar por Nombre)**
Usuario: Envía un correo a juan.perez@dominio.com con el asunto "Confirmación de Reunión" y el cuerpo "Adjunto los detalles."
Asistente: Entendido. Para personalizar el correo, ¿podrías indicarme el nombre del destinatario, por favor?

**Ejemplo 2: Pregunta por Información Faltante para Email (Tono Mejorado)**
Usuario: Envía un correo.
Asistente: Para poder enviar el correo, necesito saber a quién va dirigido (su dirección de email), cuál sería el asunto y qué mensaje deseas incluir en el cuerpo. ¿Podrías proporcionarme esos detalles, por favor?

**Ejemplo 3: Agendar una Reunión**
Usuario: Agéndame una reunión para mañana a las 10 AM con el título "Revisión de Proyecto X".
Asistente:
{"tool_call": {"name": "Calendar_Set", "arguments": {"date": "2025-07-15", "time": "10:00", "title": "Revisión de Proyecto X", "duration_minutes": 60}}}

**Ejemplo 4: Pregunta por Información Faltante para Reunión (Tono Mejorado)**
Usuario: Quiero agendar una cita.
Asistente: Claro, con gusto te ayudo a agendarla. Para ello, por favor, indícame la fecha y hora deseadas, y qué título o descripción breve te gustaría darle a esta cita.

**Ejemplo 5: Consultar Calendario**
Usuario: ¿Qué tengo agendado para el 15 de julio?
Asistente:
{"tool_call": {"name": "Calendar_Get", "arguments": {"date": "2025-07-15"}}}

**Ejemplo 6: Solicitud Fuera de Alcance (Tono Mejorado)**
Usuario: ¿Cuál es la capital de Francia?
Asistente: Entiendo tu pregunta, pero mi función principal es asistirte con tareas específicas como agendar citas, consultar tu calendario o enviar correos electrónicos. No estoy programado para responder preguntas de conocimiento general. ¿Hay alguna tarea en la que pueda ayudarte hoy?

**Ejemplo 7: Solicitud Fuera de Alcance 2 (Tono Mejorado)**
Usuario: Cuéntame un cuento divertido.
Asistente: Mi propósito es ayudarte a automatizar tus tareas usando las herramientas disponibles, no puedo generar contenido creativo como cuentos. Si necesitas ayuda con alguna gestión de calendario o correos electrónicos, con gusto te asistiré.

`;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');

    if (!apiKey) {
      this.logger.error(
        'OPENAI_API_KEY no está configurada en el archivo .env',
      );
      throw new Error('OPENAI_API_KEY is not configured in the .env file');
    }

    this.openai = new OpenAI({ apiKey });
  }

  async getAIResponse(
    userMessage: string,
    // La interfaz ChatMessage debe estar disponible aquí.
    // Si no está global o importada, dará error.
    chatHistory: ChatMessage[],
  ): Promise<string | object> {
    try {
      const messagesToSend = [
        { role: 'system', content: this.systemPrompt },
        ...chatHistory.map((msg) => {
          if (
            msg.role === 'user' ||
            msg.role === 'assistant' ||
            msg.role === 'system'
          ) {
            return { role: msg.role, content: msg.content };
          }
          // If you ever support 'function' role, add name property here
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return msg as any;
        }),
        { role: 'user', content: userMessage },
      ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      // CORRECCIÓN CLAVE: Typo en 'completions.create'
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: messagesToSend,
        tools: this.tools,
        tool_choice: 'auto',
        temperature: 0.5,
        max_tokens: 1000,
      });

      const message = response.choices[0]?.message;
      console.log('Mensaje de IA:', message);

      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        this.logger.log(
          `¡IA sugiere llamada a herramienta! Nombre: ${toolCall.function.name}, Argumentos: ${JSON.stringify(toolCall.function.arguments)}`,
        );

        return {
          tool_call: {
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || '{}'),
          },
        };
      } else {
        const aiResponseContent = message?.content ?? '';
        this.logger.log(
          `IA respondió conversacionalmente: ${aiResponseContent}`,
        );
        return aiResponseContent;
      }
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        this.logger.error(
          `Error de la API de OpenAI (Código: ${error.status || 'N/A'}): ${error.message}`,
          error.code,
        );
        return 'Lo siento, la API de OpenAI experimentó un problema. Por favor, inténtalo de nuevo más tarde.';
      } else if (error instanceof Error) {
        this.logger.error('Error general al llamar a OpenAI:', error.message);
      } else {
        this.logger.error('Error inesperado al llamar a OpenAI:', error);
      }
      return 'Lo siento, tuve un error al procesar tu solicitud. Por favor, inténtalo de nuevo.';
    }
  }
}
