/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MessagesAnnotation, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { CalendarService} from '../calendar/calendar.service'; // Asegúrate de que dotenv esté instalado y configurado
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
@Injectable()
export class PruebaService implements OnModuleInit {
  private llmWithTools!: ReturnType<ChatOpenAI['bindTools']>;
  private tools!: any[];
  private agentBuilder: any = null;
  private userHistories: Record<string, Message[]> = {};

  constructor(
    private config: ConfigService,
    private calendarService: CalendarService,
  ) {
    if (!this.config.get<string>('OPENAI_API_KEY')) {
      throw new Error('OPENAI_API_KEY no configurada');
    }
  }

  onModuleInit() {
    console.log('Inicializando PruebaService...');
    // Instancia el modelo LLM
    const llm = new ChatOpenAI({
      openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-4o', // o el modelo que prefieras
    });
    const pineconeApiKey = this.config.get<string>('PINECONE_API_KEY');
    const pineconeIndex = this.config.get<string>('PINECONE_INDEX');
    const pineconeHost = this.config.get<string>('PINECONE_HOST');
    if (!pineconeApiKey) {
      throw new Error('PINECONE_API_KEY no configurada');
    }
    if (!pineconeIndex) {
      throw new Error('PINECONE_INDEX no configurada');
    }
    if (!pineconeHost) {
      throw new Error('PINECONE_HOST no configurada');
    }
    const pc = new Pinecone({
      apiKey: pineconeApiKey,
    });
    const namespace = pc
      .index(pineconeIndex, pineconeHost)
      .namespace('example-namespace');

    const listPsychologists = tool(
      async (): Promise<string> => {
        console.log('Listing available psychologists...');
        const response = await namespace.searchRecords({
          query: {
            topK: 10,
            inputs: { text: 'Psicologos' },
            filter: {
              tipo: { $in: ['psicologo'] },
            }, // Filtra
          },
          fields: ['text', 'tipo'],
        });

        const resultados = (response.result?.hits || [])
          .map((hit) => {
            // Asegura que hit.fields tiene la propiedad text de tipo string
            const text = (hit.fields as { text?: string }).text ?? '';
            // Ejemplo de campo: "Nombre | Especialidad. Descripción... Precio: $XX.XXX COP"
            const match = text.match(
              /^(.*?)\|([^.]*)\.\s*(.*?)Precio:\s*([$\d.,\sA-Za-z]+)/i,
            );
            if (match) {
              const nombre = match[1].trim();
              const especialidad = match[3];
              const precio = match[4].trim();
              return `• ${nombre} | ${especialidad} | Precio: ${precio}`;
            }
            // Si no hay match, retorna todo el texto
            return `• ${text}`;
          })
          .join('\n\n');

        return `Lista de psicólogos disponibles:\n\n${resultados}`;
      },
      {
        name: 'listPsychologists',
        description:
          'Muestra psicólogos disponibles para agendar cita, incluyendo especialidad y precio.',
        schema: z.object({}),
      },
    );

    const getAvailableSlots = tool(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async ({ psychologist, date }) => {
        console.log(
          `Obteniendo horarios disponibles para ${psychologist} en ${date}...`,
        );
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
      {
        name: 'getAvailableSlots',
        description:
          'Devuelve horarios libres de un psicólogo en una fecha específica.',
        schema: z.object({
          psychologist: z.string().describe('Nombre del psicólogo'),
          date: z.string().describe('Fecha solicitada (YYYY-MM-DD)'),
        }),
      },
    );

    const createAppointment = tool(
      async ({ psychologist, date, hour, clientName, email }) => {
        console.log(
          `Agendando cita con ${psychologist} el ${date} a las ${hour} a nombre de ${clientName} (${email})...`,
        );
        await this.calendarService.createEvent(
          date,
          hour,
          'Cita con Pscicólogo(a) ' + psychologist,
          60,
          [email],
        );
        return `✅ Cita agendada con ${psychologist} el ${date} a las ${hour} a nombre de ${clientName}`;
      },
      {
        name: 'createAppointment',
        description:
          'Agenda una cita en Google Calendar con el psicólogo elegido.',
        schema: z.object({
          psychologist: z.string(),
          date: z.string(),
          hour: z.string(),
          clientName: z.string(),
          email: z.string().email(),
        }),
      },
    );

    this.tools = [listPsychologists, getAvailableSlots, createAppointment];
    this.llmWithTools = llm.bindTools(this.tools);

    // Función de llamada al LLM
    const llmCall = async (state: typeof MessagesAnnotation.State) => {
      const result = await this.llmWithTools.invoke([
        {
          role: 'system',
          content: `Eres un asistente conversacional para la app Appodium. Tu tarea es ayudar al usuario a agendar una cita con uno de los psicólogos disponibles, siempre guiando la conversación paso a paso. 

          **Reglas:**
          - Saluda y da la bienvenida.
          - Pregunta si desea agendar una cita.
          - Si responde que sí, muestra la lista de psicólogos disponibles.
          - Espera a que el usuario elija un psicólogo.
          - Pide la fecha para la cita.
          - Cuando la tengas, consulta los horarios disponibles para ese psicólogo y fecha.
          - Espera a que el usuario elija la hora.
          - Cuando la hora esté definida
          - Pregunta el nombre del cliente y el email
          - Agenda la cita en Google Calendar.
          - Confirma la cita y despídete.

          **Muy importante:**
          - Nunca asumas datos que el usuario no te haya dado.
          - Haz preguntas cortas y claras.
          - Si el usuario da información antes de que la pidas (ej: dice psicólogo y fecha en el mismo mensaje), procesa todo lo posible, pero igual confirma los pasos.
          - Si el usuario da una respuesta ambigua, pídele aclarar.
          - No muestres toda la información ni preguntes varias cosas a la vez.
          - Sé amable y profesional.`,
        },
        ...state.messages,
      ]);
      return { messages: [result] };
    };
    const toolNode = new ToolNode(this.tools);

    // Función condicional para decidir el flujo
    function shouldContinue(state) {
      const messages = state.messages;
      const lastMessage = messages.at(-1);
      if (lastMessage?.tool_calls?.length) {
        return 'Action';
      }
      return '__end__';
    }

    // Construye el grafo del agente
    this.agentBuilder = new StateGraph(MessagesAnnotation)
      .addNode('llmCall', llmCall)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'llmCall')
      .addConditionalEdges('llmCall', shouldContinue, {
        Action: 'tools',
        __end__: '__end__',
      })
      .addEdge('tools', 'llmCall')
      .compile();
  }

  // Método público para usar el agente
  async calcular(mensaje: string) {
    const messages = [
      {
        role: 'user',
        content: mensaje,
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await this.agentBuilder.invoke({ messages });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return result.messages.at(-1)?.content || 'No response from agent';
  }

  async conversar(userId: string, mensaje: string) {
    // Inicializa el historial del usuario si no existe
    if (!this.userHistories[userId]) {
      this.userHistories[userId] = [];
    }

    // Agrega el mensaje del usuario al historial
    this.userHistories[userId].push({
      role: 'user',
      content: mensaje,
    });

    // Opcional: limita el historial a los últimos N mensajes para ahorrar tokens
    const MAX_HISTORY = 12;
    const messagesToSend = this.userHistories[userId].slice(-MAX_HISTORY);

    // Ejecuta el agente con todo el historial relevante
    const result = await this.agentBuilder.invoke({ messages: messagesToSend });

    // Agrega la respuesta de la IA al historial
    if (result.messages.at(-1)?.content) {
      this.userHistories[userId].push({
        role: 'assistant',
        content: result.messages.at(-1).content,
      });
    }

    // Devuelve la última respuesta de la IA
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return result.messages.at(-1)?.content || 'No response from agent';
  }
}
