/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
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

interface PineconeSearchResult {
  fields?: { text?: string; tipo?: string };
}

@Injectable()
export class PruebaService implements OnModuleInit {
  private readonly logger = new Logger(PruebaService.name);
  private llmWithTools!: ReturnType<ChatOpenAI['bindTools']>;
  private tools!: any[];
  private agentBuilder: any = null;
  private userHistories: Record<string, Message[]> = {};
  private tokenCounter: number = 0;
  private pineconeNamespace: any = null;

  constructor(
    private config: ConfigService,
    private calendarService: CalendarService,
    private readonly dynamoService: DynamoService,
    private readonly logService: S3ConversationLogService,
  ) {
    this.validateEnvironmentVariables();
  }

  private validateEnvironmentVariables(): void {
    const requiredVars = [
      'OPENAI_API_KEY',
      'PINECONE_API_KEY',
      'PINECONE_INDEX',
      'PINECONE_HOST',
    ];

    for (const varName of requiredVars) {
      if (!this.config.get<string>(varName)) {
        throw new Error(
          `${varName} no configurada en las variables de entorno`,
        );
      }
    }
  }

  private validateInput(input: any, fieldName: string): void {
    if (!input || (typeof input === 'string' && input.trim() === '')) {
      throw new Error(`${fieldName} es requerido y no puede estar vacío`);
    }
  }

  onModuleInit() {
    try {
      this.initializeLLM();
      this.initializePinecone();
      this.initializeTools();
      this.buildAgent();
    } catch (error) {
      this.logger.error('Failed to initialize agent service', error);
      throw error;
    }
  }

  private initializeLLM(): void {
    try {
      this.logger.log('LLM will be initialized in buildAgent method');
    } catch (error) {
      this.logger.error('Failed to initialize LLM', error);
      throw new Error('Error al inicializar el modelo de lenguaje');
    }
  }

  private initializePinecone(): void {
    try {
      const pineconeApiKey = this.config.get<string>('PINECONE_API_KEY');
      const pineconeIndex = this.config.get<string>('PINECONE_INDEX');
      const pineconeHost = this.config.get<string>('PINECONE_HOST');

      const pc = new Pinecone({
        apiKey: pineconeApiKey!,
      });

      this.pineconeNamespace = pc
        .index(pineconeIndex as string, pineconeHost as string)
        .namespace('example-namespace');

      this.logger.log('Pinecone initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Pinecone', error);
      throw new Error('Error al inicializar Pinecone');
    }
  }

  private async searchPinecone(
    searchText: string,
    filterType: string[],
  ): Promise<PineconeSearchResult[]> {
    try {
      this.validateInput(searchText, 'searchText');

      if (!Array.isArray(filterType) || filterType.length === 0) {
        throw new Error('filterType debe ser un array no vacío');
      }

      const response = await this.pineconeNamespace.searchRecords({
        query: {
          topK: 8,
          inputs: { text: searchText },
          filter: { tipo: { $in: filterType } },
        },
        fields: ['text', 'tipo'],
      });

      return (response.result?.hits || []) as PineconeSearchResult[];
    } catch (error) {
      this.logger.error(`Error searching Pinecone for "${searchText}"`, error);
      return [];
    }
  }

  private formatResult(text: string): string {
    try {
      if (!text || typeof text !== 'string') {
        return '• Información no disponible';
      }

      const match = text.match(
        /^(.*?)\|([^.]*)\.\s*(.*?)Precio:\s*([$\d.,\sA-Za-z]+)/i,
      );

      if (match) {
        const [, nombre, , especialidad, precio] = match;
        return `• ${nombre.trim()} | ${especialidad.trim()} | ${precio.trim()}`;
      }
      return `• ${text}`;
    } catch (error) {
      this.logger.error('Error formatting result', error);
      return `• ${text}`;
    }
  }

  private initializeTools(): void {
    try {
      const membershipPrices = tool(
        async (): Promise<string> => {
          try {
            const hits = await this.searchPinecone('membershipPrices', [
              'membershipPrices',
            ]);

            if (hits.length === 0) {
              return 'No hay afiliaciones disponibles en este momento.';
            }

            const resultados = hits
              .map((hit) => this.formatResult(hit.fields?.text ?? ''))
              .filter((result) => result !== '• Información no disponible')
              .join('\n');

            return resultados
              ? `Afiliaciones disponibles:\n${resultados}`
              : 'No hay afiliaciones disponibles.';
          } catch (error) {
            this.logger.error('Error in membershipPrices tool', error);
            return 'Error al obtener precios de afiliaciones. Intente nuevamente.';
          }
        },
        {
          name: 'membershipPrices',
          description: 'Obtiene precios de afiliaciones disponibles',
          schema: z.object({}),
        },
      );

      const policyPrices = tool(
        async (): Promise<string> => {
          try {
            const hits = await this.searchPinecone('policyPrices', [
              'policyPrices',
            ]);

            if (hits.length === 0) {
              return 'No hay pólizas disponibles en este momento.';
            }

            const resultados = hits
              .map((hit) => this.formatResult(hit.fields?.text ?? ''))
              .filter((result) => result !== '• Información no disponible')
              .join('\n');

            return resultados
              ? `Pólizas disponibles:\n${resultados}`
              : 'No hay pólizas disponibles.';
          } catch (error) {
            this.logger.error('Error in policyPrices tool', error);
            return 'Error al obtener precios de pólizas. Intente nuevamente.';
          }
        },
        {
          name: 'policyPrices',
          description: 'Obtiene precios de pólizas disponibles',
          schema: z.object({}),
        },
      );

      const about = tool(
        async (): Promise<string> => {
          try {
            const hits = await this.searchPinecone('Que es afiliamos?', [
              'descripcion',
            ]);

            if (hits.length === 0) {
              return 'Información sobre Afiliamos no disponible en este momento.';
            }

            const resultados = hits
              .map((hit) => `• ${hit.fields?.text ?? 'Sin información'}`)
              .filter((result) => result !== '• Sin información')
              .join('\n');

            return resultados
              ? `Sobre Afiliamos:\n${resultados}`
              : 'Información no disponible.';
          } catch (error) {
            this.logger.error('Error in about tool', error);
            return 'Error al obtener información sobre Afiliamos.';
          }
        },
        {
          name: 'aboutAfiliamos',
          description: 'Información sobre la empresa Afiliamos',
          schema: z.object({}),
        },
      );

      const services = tool(
        async (): Promise<string> => {
          try {
            const hits = await this.searchPinecone('servicios', ['servicios']);

            if (hits.length === 0) {
              return 'No hay servicios disponibles en este momento.';
            }

            const resultados = hits
              .map((hit) => `• ${hit.fields?.text ?? 'Sin información'}`)
              .filter((result) => result !== '• Sin información')
              .join('\n');

            return resultados
              ? `Servicios:\n${resultados}`
              : 'Servicios no disponibles.';
          } catch (error) {
            this.logger.error('Error in services tool', error);
            return 'Error al obtener servicios disponibles.';
          }
        },
        {
          name: 'servicesAfiliamos',
          description: 'Servicios ofrecidos por Afiliamos',
          schema: z.object({}),
        },
      );

      const risks = tool(
        async (): Promise<string> => {
          try {
            const hits = await this.searchPinecone('Riesgos ARL', ['risk']);

            if (hits.length === 0) {
              return 'Información sobre riesgos ARL no disponible.';
            }

            const resultados = hits
              .map((hit) => `• ${hit.fields?.text ?? 'Sin información'}`)
              .filter((result) => result !== '• Sin información')
              .join('\n');

            return resultados
              ? `Riesgos ARL:\n${resultados}`
              : 'Información sobre riesgos no disponible.';
          } catch (error) {
            this.logger.error('Error in risks tool', error);
            return 'Error al obtener información sobre riesgos ARL.';
          }
        },
        {
          name: 'risks',
          description: 'Información sobre niveles de riesgo ARL',
          schema: z.object({}),
        },
      );

      const form = tool(
        (): Promise<string> => {
          try {
            const formFields = [
              'NOMBRE COMPLETO:',
              'CEDULA:',
              'CIUDAD IPS:',
              'FECHA INGRESO:',
              'EPS:',
              'PENSION:',
              'CAJA:',
              'NIVEL DE RIESGO O POLIZA:',
              'CELULAR:',
              'DIRECCION:',
            ];

            const formattedForm = formFields.join('\n');
            return Promise.resolve(
              `Formulario de afiliación:\n${formattedForm}`,
            );
          } catch (error) {
            this.logger.error('Error in form tool', error);
            return Promise.resolve(
              'Error al obtener formulario de afiliación.',
            );
          }
        },
        {
          name: 'form',
          description: 'Formulario requerido para afiliación',
          schema: z.object({}),
        },
      );

      const createUser = tool(
        async ({
          name,
          doc,
          ips,
          date,
          eps,
          pension,
          box,
          risk,
          phone,
          address,
          service,
        }) => {
          try {
            // Validación de entrada
            const requiredFields = {
              name: 'Nombre',
              doc: 'Documento',
              ips: 'Ciudad IPS',
              date: 'Fecha de ingreso',
              eps: 'EPS',
              pension: 'Pensión',
              box: 'Caja',
              risk: 'Nivel de riesgo',
              phone: 'Teléfono',
              address: 'Dirección',
              service: 'Servicio',
            };

            const params = {
              name,
              doc,
              ips,
              date,
              eps,
              pension,
              box,
              risk,
              phone,
              address,
              service,
            };

            for (const [field, label] of Object.entries(requiredFields)) {
              this.validateInput(params[field], label);
            }

            this.logger.log(`Creating user: ${name}, Doc: ${doc}`);

            const result = await this.dynamoService.crearUsuario(
              name,
              doc,
              ips,
              date,
              eps,
              pension,
              box,
              risk,
              phone,
              address,
              service,
            );

            if (!result.success) {
              throw new Error(
                result.message || 'Error desconocido al crear usuario',
              );
            }

            this.logger.log(`User created successfully: ${name}`);
            return `✅ Usuario ${name} creado exitosamente`;
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : 'Error inesperado';
            this.logger.error(`Error creating user: ${errorMessage}`, error);
            return `❌ Error al crear usuario: ${errorMessage}`;
          }
        },
        {
          name: 'createUser',
          description: 'Crea usuario con datos del formulario',
          schema: z.object({
            name: z.string().min(1, 'Nombre es requerido'),
            doc: z.string().min(1, 'Documento es requerido'),
            ips: z.string().min(1, 'Ciudad IPS es requerida'),
            date: z.string().min(1, 'Fecha de ingreso es requerida'),
            eps: z.string().min(1, 'EPS es requerida'),
            pension: z.string().min(1, 'Pensión es requerida'),
            box: z.string().min(1, 'Caja es requerida'),
            risk: z.string().min(1, 'Nivel de riesgo es requerido'),
            phone: z.string().min(1, 'Teléfono es requerido'),
            address: z.string().min(1, 'Dirección es requerida'),
            service: z.string().min(1, 'Servicio es requerido'),
          }),
        },
      );

      this.tools = [
        about,
        services,
        membershipPrices,
        policyPrices,
        risks,
        form,
        createUser,
      ];
    } catch (error) {
      this.logger.error('Failed to initialize tools', error);
      throw new Error('Error al inicializar herramientas');
    }
  }

  private buildAgent(): void {
    try {
      const llm = new ChatOpenAI({
        openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
        modelName: 'gpt-4o-mini',
        temperature: 0.1,
      });

      this.llmWithTools = llm.bindTools(this.tools);

      const llmCall = async (state: typeof MessagesAnnotation.State) => {
        try {
          // Prompt optimizado y más corto
          const systemPrompt =
            'Asistente Afiliamos: Saluda, pregunta por servicios, muestra precios, solicita formulario cuando elijan servicio, confirma que asesor contactará para pago.';
          const systemMessage = { role: 'system', content: systemPrompt };

          const trimmedMessages = await this.trimMessagesWithErrorHandling(
            state.messages,
          );

          const result = await this.llmWithTools.invoke([
            systemMessage,
            ...trimmedMessages,
          ]);

          this.calcular(result.response_metadata?.tokenUsage?.totalTokens);

          if (result.tool_calls && result.tool_calls.length > 0) {
            this.logger.debug('LLM requested tools, continuing to tools node');
            return { messages: [result] };
          }

          // Resumen solo cuando sea necesario
          if (trimmedMessages.length >= 10) {
            const summarizationResult = await this.handleSummarization(
              llm,
              trimmedMessages,
              result,
            );
            return summarizationResult as { messages: any[] };
          }

          return { messages: [result] };
        } catch (error) {
          this.logger.error('Error in llmCall', error);
          const errorMessage = {
            role: 'assistant',
            content:
              'Lo siento, ocurrió un error. Por favor intente nuevamente.',
          };
          return { messages: [errorMessage] };
        }
      };

      const toolNode = new ToolNode(this.tools);

      const shouldContinue = (state: any) => {
        try {
          const messages = state.messages;
          const lastMessage = messages.at(-1);
          return lastMessage?.tool_calls?.length ? 'Action' : '__end__';
        } catch (error) {
          this.logger.error('Error in shouldContinue', error);
          return '__end__';
        }
      };

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
    } catch (error) {
      this.logger.error('Failed to build agent', error);
      throw new Error('Error al construir el agente');
    }
  }

  private async trimMessagesWithErrorHandling(messages: any[]): Promise<any[]> {
    try {
      return await trimMessages(messages, {
        maxTokens: 2000,
        strategy: 'last',
        tokenCounter: (msgs) => {
          try {
            return msgs.reduce((total, msg) => {
              const content =
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content);
              return total + Math.ceil(content.length / 4);
            }, 0);
          } catch (error) {
            this.logger.error('Error in token counter', error);
            return 0;
          }
        },
        includeSystem: false,
      });
    } catch (error) {
      this.logger.error('Error trimming messages', error);
      return messages.slice(-5); // Fallback: keep last 5 messages
    }
  }

  private async handleSummarization(
    llm: any,
    trimmedMessages: any[],
    result: any,
  ): Promise<any> {
    try {
      this.logger.debug('Starting summarization process, ', trimmedMessages);
      const summaryPrompt =
        'Resumen: extrae datos importantes (precios, servicios elegidos, datos formulario)';
      const summaryMessage = await llm.invoke([
        ...trimmedMessages.slice(-4),
        { role: 'user', content: summaryPrompt },
      ]);

      this.logger.debug('Summarization completed');

      const deleteMessages = trimmedMessages
        .slice(0, -2)
        .filter((m) => typeof m.id === 'string')
        .map((m) => new RemoveMessage({ id: m.id as string }));

      this.calcular(summaryMessage.response_metadata?.tokenUsage?.totalTokens);

      return {
        messages: [summaryMessage, result, ...deleteMessages],
      };
    } catch (error) {
      this.logger.error('Error in summarization', error);
      return { messages: [result] };
    }
  }

  calcular(total_tokens: any): void {
    try {
      this.tokenCounter = (this.tokenCounter || 0) + (total_tokens || 0);

      if (this.tokenCounter % 100 < (total_tokens || 0)) {
        this.logger.log(`Tokens utilizados: ${this.tokenCounter}`);
      }
    } catch (error) {
      this.logger.error('Error calculating tokens', error);
    }
  }

  async conversar(userId: string, mensaje: string): Promise<string> {
    try {
      // Validación de entrada
      this.validateInput(userId, 'userId');
      this.validateInput(mensaje, 'mensaje');

      // Inicializar historial si es necesario
      if (!this.userHistories[userId]) {
        this.userHistories[userId] = [];
      }

      // Limitar tamaño del historial
      const maxHistorySize = 20;
      if (this.userHistories[userId].length >= maxHistorySize) {
        this.userHistories[userId] = this.userHistories[userId].slice(-10);
      }

      const timestamp = new Date().toISOString();
      this.userHistories[userId].push({
        threadId: userId,
        role: 'user',
        content: mensaje,
        timestamp,
      });

      if (!this.agentBuilder) {
        throw new Error('Agent no inicializado correctamente');
      }

      const result = await this.agentBuilder.invoke(
        {
          messages: [{ role: 'user', content: mensaje }],
        },
        {
          configurable: { thread_id: userId },
        },
      );

      const lastContent = result.messages.at(-1)?.content;
      const responseContent =
        typeof lastContent === 'string'
          ? lastContent
          : 'Lo siento, no pude procesar su solicitud.';

      this.userHistories[userId].push({
        threadId: userId,
        role: 'assistant',
        content: responseContent,
        timestamp,
      });

      this.logger.log(`Conversation processed for user: ${userId}`);
      return responseContent;
    } catch (error) {
      this.logger.error(`Error in conversation for user ${userId}`, error);
      return 'Lo siento, ocurrió un error al procesar su mensaje. Por favor intente nuevamente.';
    }
  }

  async finalizeConversation(threadId: string): Promise<void> {
    try {
      this.validateInput(threadId, 'threadId');

      const history = this.userHistories[threadId];

      if (!history || history.length === 0) {
        this.logger.warn(`No history found for thread: ${threadId}`);
        return;
      }

      const conversation: Message[] = history.map((message) => ({
        threadId,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      }));

      await this.logService.saveConversation(threadId, conversation);
      delete this.userHistories[threadId];

      this.logger.log(`Conversation ${threadId} finalized and saved`);
    } catch (error) {
      this.logger.error(`Error finalizing conversation ${threadId}`, error);
      // No lanzar error para evitar interrumpir el flujo
    }
  }

  @Cron('*/10 * * * *')
  async handleCleanupCron(): Promise<void> {
    try {
      const now = Date.now();
      const tenMin = 10 * 60 * 1000;
      let cleanedCount = 0;

      for (const [threadId, history] of Object.entries(this.userHistories)) {
        try {
          if (!history || history.length === 0) continue;

          const lastMsg = history[history.length - 1];
          if (!lastMsg || !lastMsg.timestamp) continue;

          const lastTs = new Date(lastMsg.timestamp).getTime();
          if (isNaN(lastTs)) continue;

          if (now - lastTs > tenMin) {
            await this.finalizeConversation(threadId);
            cleanedCount++;
          }
        } catch (error) {
          this.logger.error(`Error cleaning up thread ${threadId}`, error);
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`Cleaned up ${cleanedCount} inactive conversations`);
      }
    } catch (error) {
      this.logger.error('Error in cleanup cron job', error);
    }
  }
}
