/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  MessagesAnnotation,
  StateGraph,
  MemorySaver,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ConfigService } from '@nestjs/config';
import { Pinecone } from '@pinecone-database/pinecone';
import { CalendarService } from '../calendar/calendar.service';
import { trimMessages, RemoveMessage } from '@langchain/core/messages';
import { DynamoService } from '../database/dynamo/dynamo.service';
import { S3ConversationLogService } from 'src/conversation-log/s3-conversation-log.service';
import { Cron } from '@nestjs/schedule';
interface Message {
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
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
    private readonly dynamoService: DynamoService,
    private readonly logService: S3ConversationLogService,
  ) {
    if (!this.config.get<string>('OPENAI_API_KEY')) {
      throw new Error('OPENAI_API_KEY no configurada');
    }
  }

  onModuleInit() {
    const llm = new ChatOpenAI({
      openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-4o-mini',
    });
    const llmSumarize = new ChatOpenAI({
      openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-3.5-turbo',
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
            },
          },
          fields: ['text', 'tipo'],
        });

        const resultados = (response.result?.hits || [])
          .map((hit) => {
            const text = (hit.fields as { text?: string }).text ?? '';
            const match = text.match(
              /^(.*?)\|([^.]*)\.\s*(.*?)Precio:\s*([$\d.,\sA-Za-z]+)/i,
            );
            if (match) {
              const nombre = match[1].trim();
              const especialidad = match[3];
              const precio = match[4].trim();
              return `• ${nombre} | ${especialidad} | Precio: ${precio}`;
            }
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
            },
          },
          fields: ['text', 'tipo'],
        });

        const resultados = (response.result?.hits || [])
          .map((hit) => {
            const text = (hit.fields as { text?: string }).text ?? '';
            const match = text.match(
              /^(.*?)\|([^.]*)\.\s*(.*?)Precio:\s*([$\d.,\sA-Za-z]+)/i,
            );
            if (match) {
              const nombre = match[1].trim();
              const especialidad = match[3];
              const precio = match[4].trim();
              return `• ${nombre} | ${especialidad} | Precio: ${precio}`;
            }
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

    const servicesAppodium = tool(
      async (): Promise<string> => {
        console.log('Servicios que ofrece?');
        const response = await namespace.searchRecords({
          query: {
            topK: 10,
            inputs: { text: 'Servicios ofrecidos' },
            filter: {
              tipo: { $in: ['servicio'] },
            },
          },
          fields: ['text', 'tipo'],
        });

        const resultados = (response.result?.hits || [])
          .map((hit) => {
            const text = (hit.fields as { text?: string }).text ?? '';
            return `• ${text}`;
          })
          .join('\n\n');
        return `Servicios ofrecidos:\n\n${resultados}`;
      },
      {
        name: 'servicesAppodium',
        description:
          'Provee una descripción clara sobre los servicios que ofrece Appodium',
        schema: z.object({}),
      },
    );

    const getAvailableSlots = tool(
      async ({ psychologist, date }) => {
        console.log(
          `Obteniendo horarios disponibles para ${psychologist} en ${date}...`,
        );
        try {
          const availableSlots =
            await this.dynamoService.obtenerHuecosDisponibles(
              psychologist,
              date,
            );

          if (!availableSlots || availableSlots.length === 0) {
            console.warn(
              `No se encontraron horarios disponibles para ${psychologist} en la fecha ${date}.`,
            );
            return `❌ No hay horarios disponibles para agendar el ${date}. Por favor, elige otra fecha.`;
          }
          return availableSlots;
        } catch (error: unknown) {
          if (error instanceof Error) {
            console.error(
              `Error al obtener horarios disponibles para ${psychologist} el ${date}: ${error.message}`,
            );
            return `❌ Error al obtener horarios disponibles: ${error.message}`;
          } else {
            console.error(
              'Error desconocido al obtener los horarios disponibles.',
            );
            return '❌ Ocurrió un error inesperado al intentar obtener los horarios disponibles.';
          }
        }
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
        try {
          const result = await this.dynamoService.crearCita(
            date,
            hour,
            psychologist,
            email,
          );

          if (!result.success) {
            throw new Error(result.message);
          }
          const calendarResponse = await this.calendarService.createEvent(
            date,
            hour,
            'Cita con Pscicólogo(a) ' + psychologist,
            60,
            [email, result.psicologo],
          );
          if (!calendarResponse) {
            throw new Error('No se pudo crear el evento en Google Calendar');
          }
          return `✅ Cita agendada con ${psychologist} el ${date} a las ${hour} a nombre de ${clientName}`;
        } catch (error: unknown) {
          if (error instanceof Error) {
            console.error('Error al agendar cita:', error.message);
            return `❌ Error al agendar cita: ${error.message}`;
          } else {
            console.error('Error al agendar cita: Error desconocido');
            return `❌ Error al agendar cita: Ocurrió un error inesperado`;
          }
        }
      },
      {
        name: 'createAppointment',
        description:
          'Agenda una cita en Google Calendar con el psicólogo elegido. Debe recibir el psicólogo, fecha, hora, nombre del cliente y correo electrónico.',
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
      servicesAppodium,
      listPsychologists,
      getAvailableSlots,
      createAppointment,
    ];
    this.llmWithTools = llm.bindTools(this.tools);

    const llmCall = async (state: typeof MessagesAnnotation.State) => {
      const systemPrompt =
        'Appodium: Asistente para citas con psicólogos. Saluda, ofrece servicios/cita. Si piden cita (o tras servicios), presenta *todos* los psicólogos disponibles, Si el producto no existe no digas que no existe. solo muestra la lista de psicologos. pregunta fecha para obtener citas disponibles y luego pide nombre y correo para crear cita';
      const systemMessage = { role: 'system', content: systemPrompt };
      const trimmedMessages = await trimMessages(state.messages, {
        maxTokens: 20,
        strategy: 'last',
        tokenCounter: (msgs) => msgs.length,
        includeSystem: true,
      });

      const result = await this.llmWithTools.invoke([
        systemMessage,
        ...trimmedMessages,
      ]);
      this.calcular(result.response_metadata.tokenUsage.totalTokens);
      if (result.tool_calls && result.tool_calls.length > 0) {
        console.log(
          "LLM ha solicitado herramientas. El grafo continuará con 'tools'.",
        );
        return { messages: [result] };
      }
      if (trimmedMessages.length >= 6) {
        const summaryPrompt =
          'Resume la siguiente conversación extrayendo los datos de la cita agendada (Nombre, Email, Profesional, Fecha, Hora, Precio) en una lista.';
        const summaryMessage = await llmSumarize.invoke([
          ...trimmedMessages,
          { role: 'user', content: summaryPrompt },
        ]);
        const deleteMessages = trimmedMessages
          .filter((m) => typeof m.id === 'string')
          .map((m) => new RemoveMessage({ id: m.id as string }));
        this.calcular(summaryMessage.response_metadata?.tokenUsage.totalTokens);
        return {
          messages: [summaryMessage, result, ...deleteMessages],
        };
      }

      return { messages: [result] };
    };
    const toolNode = new ToolNode(this.tools);

    function shouldContinue(state) {
      const messages = state.messages;
      const lastMessage = messages.at(-1);
      if (lastMessage?.tool_calls?.length) {
        return 'Action';
      }
      return '__end__';
    }

    this.agentBuilder = new StateGraph(MessagesAnnotation)
      .addNode('llmCall', llmCall)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'llmCall')
      .addConditionalEdges('llmCall', shouldContinue, {
        Action: 'tools',
        __end__: '__end__',
      })
      .addEdge('tools', 'llmCall')
      .compile({ checkpointer: new MemorySaver() });
  }

  calcular(total_tokens: any) {
    this.tokenCounter = this.tokenCounter + total_tokens || 0;
    console.log('Tokens utilizados:', this.tokenCounter);
  }

  async conversar(userId: string, mensaje: string) {
    if (!this.userHistories[userId]) {
      this.userHistories[userId] = [];
    }
    this.userHistories[userId].push({
      threadId: userId,
      role: 'user',
      content: mensaje,
      timestamp: new Date().toISOString(),
    });

    const result = await this.agentBuilder.invoke(
      {
        messages: [
          {
            role: 'user',
            content: mensaje,
          },
        ],
      },
      {
        configurable: { thread_id: userId },
      },
    );
    this.userHistories[userId].push({
      threadId: userId,
      role: 'assistant',
      content: result.messages.at(-1)?.content,
      timestamp: new Date().toISOString(),
    });

    const lastContent = result.messages.at(-1)?.content;
    return typeof lastContent === 'string'
      ? lastContent
      : 'No response from agent';
  }

  async finalizeConversation(threadId: string) {
    const history = this.userHistories[threadId];

    if (!history || history.length === 0) return;

    const conversation: Message[] = history.map((message) => ({
      threadId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    }));

    await this.logService.saveConversation(threadId, conversation);
    delete this.userHistories[threadId];
    console.log(`Conversation ${threadId} finalized and saved to S3.`);
  }

  @Cron('*/10 * * * *')
  async handleCleanupCron() {
    const now = Date.now();
    const tenMin = 10 * 60 * 1000;
    for (const [threadId, history] of Object.entries(this.userHistories)) {
      const lastMsg = history[history.length - 1];
      const lastTs = new Date(lastMsg.timestamp).getTime();
      if (now - lastTs > tenMin) {
        console.log(`Thread ${threadId} inactive for >10min, finalizing…`);
        await this.finalizeConversation(threadId);
      }
    }
  }
}
