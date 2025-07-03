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
import { CalendarService } from '../calendar/calendar.service'; // Asegúrate de que dotenv esté instalado y configurado
import { trimMessages } from '@langchain/core/messages';
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
  private tokenCounter: number = 0;

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
      modelName: 'gpt-4o-mini', // o el modelo que prefieras
    });
    llm.callbacks = [
      {
        handleLLMStart: (llm, prompts) => {
          console.log('Prompt real enviado:', prompts);
        },
      },
    ];
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

    const aboutAppodium = tool(
      async (): Promise<string> => {
        console.log('Que es appodium?');
        const response = await namespace.searchRecords({
          query: {
            topK: 10,
            inputs: { text: 'Que es Appodium?' },
            filter: {
              tipo: { $in: ['descripcion'] },
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
        name: 'aboutAppodium',
        description:
          'Provee una descripción clara sobre qué es Appodium, su misión, visión y funcionamiento.',
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

    this.tools = [
      aboutAppodium,
      listPsychologists,
      getAvailableSlots,
      createAppointment,
    ];
    this.llmWithTools = llm.bindTools(this.tools);

    // Función de llamada al LLM
    const llmCall = async (state: typeof MessagesAnnotation.State) => {
      const trimmedMessages = await trimMessages(state.messages, {
        maxTokens: 250,
        strategy: 'last',
        tokenCounter: new ChatOpenAI({
          openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
          modelName: 'gpt-4o-mini',
        }),
      });
      console.log('Mensajes después de recortar:', trimmedMessages);
      const result = await this.llmWithTools.invoke([
        {
          role: 'system',
          content: `"Eres un asistente de Appodium. Ayuda a agendar citas con psicólogos. Saluda y pregunta si desean una cita, muestra psicólogos disponibles, pregunta fecha para obtener citas disponibles y luego pide nombre y correo para crear cita`,
        },
        ...trimmedMessages,
      ]);
      console.log('Respuesta del LLM:', result.response_metadata.usage);
      this.calcular(result.response_metadata.usage.total_tokens);
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
  calcular(total_tokens: any) {
    console.log('Calculando tokens utilizados...: ', total_tokens);
    this.tokenCounter = this.tokenCounter + total_tokens || 0;
    console.log('Tokens utilizados:', this.tokenCounter);
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
    const MAX_HISTORY = 6;
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
