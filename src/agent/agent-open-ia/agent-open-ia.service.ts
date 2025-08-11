/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Agent, tool, run, withTrace } from '@openai/agents';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { Pinecone } from '@pinecone-database/pinecone';
import { SemanticCacheService } from 'src/semantic-cache/semantic-cache.service';
import { StringPromptValue } from '@langchain/core/prompt_values';

interface PineconeSearchResult {
  fields?: Record<string, string | undefined>;
}
interface payLoad {
  type: 'text' | 'button' | 'plantilla' | 'unsupported';
  text?: string;
  action?: string;
  template?: string;
  actions?: {
    services?: string;
    activityEconomic?: string;
  };
}

interface sendWhastappResponse {
  type: 'plantilla' | 'texto';
  template?: string;
  text?: string;
}

@Injectable()
export class AgentOpenIaService implements OnModuleInit {
  private readonly logger = new Logger(AgentOpenIaService.name);
  private orchestratorAgent!: any;
  private synthesizerAgent!: any;
  private readonly MODEL_NAME = 'gpt-4o-mini';
  private pineconeNamespace: any = null;

  constructor(
    private config: ConfigService,
    private readonly dynamoService: DynamoService,
    private readonly semanticCacheService: SemanticCacheService,
  ) {
    this.validateEnvironmentVariables();
  }

  onModuleInit() {
    try {
      this.initializeTools();
      this.initializePinecone();
      this.initializeSynthesizerAgent();
    } catch (error) {
      this.logger.error('Failed to initialize agent service', error);
      throw new Error('Failed to initialize agent service');
    }
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

  private validateInput(input: any, fieldName: string): void {
    if (!input || (typeof input === 'string' && input.trim() === '')) {
      throw new Error(`${fieldName} es requerido y no puede estar vacío`);
    }
  }

  private async searchPinecone(
    searchText: string,
    filterType: string[],
    fields: string[],
  ): Promise<PineconeSearchResult[]> {
    try {
      this.validateInput(searchText, 'searchText');

      if (!Array.isArray(filterType) || filterType.length === 0) {
        throw new Error('filterType debe ser un array no vacío');
      }

      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error('fields debe ser un array no vacío');
      }

      const response = await this.pineconeNamespace.searchRecords({
        query: {
          topK: 8,
          inputs: { text: searchText },
          filter: { tipo: { $in: filterType } },
        },
        fields,
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
      const self = this;
      const dependentPrices = tool({
        name: 'dependentPrices',
        description:
          'Obtiene precios de afiliacionesa a seguridad social para personas dependientes',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone(
              'membershipPrices',
              ['membershipPrices'],
              ['text', 'tipo'],
            );

            if (hits.length === 0) {
              return 'No hay afiliaciones disponibles en este momento.';
            }

            const resultados = hits
              .map((hit) => self.formatResult(hit.fields?.text ?? ''))
              .filter((result) => result !== '• Información no disponible')
              .join('\n');

            return resultados
              ? `Afiliaciones disponibles:\n${resultados}`
              : 'No hay afiliaciones disponibles.';
          } catch (error) {
            self.logger.error('Error in membershipPrices tool', error);
            return 'Error al obtener precios de afiliaciones. Intente nuevamente.';
          }
        },
      });

      const independentPrices = tool({
        name: 'independentPrices',
        description:
          'Obtiene precios de afiliacionesa a seguridad social para personas independientes',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone(
              'independentPrices',
              ['independentPrices'],
              ['text', 'tipo'],
            );

            if (hits.length === 0) {
              return 'No hay afiliaciones disponibles en este momento.';
            }

            const resultados = hits
              .map((hit) => self.formatResult(hit.fields?.text ?? ''))
              .filter((result) => result !== '• Información no disponible')
              .join('\n');

            return resultados
              ? `Afiliaciones disponibles:\n${resultados}`
              : 'No hay afiliaciones disponibles.';
          } catch (error) {
            self.logger.error('Error in membershipPrices tool', error);
            return 'Error al obtener precios de afiliaciones. Intente nuevamente.';
          }
        },
      });

      const policyPrices = tool({
        name: 'policyPrices',
        description: 'Obtiene precios de pólizas disponibles',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone(
              'policyPrices',
              ['policyPrices'],
              ['text', 'tipo'],
            );

            if (hits.length === 0) {
              return 'No hay pólizas disponibles en este momento.';
            }

            const resultados = hits
              .map((hit) => self.formatResult(hit.fields?.text ?? ''))
              .filter((result) => result !== '• Información no disponible')
              .join('\n');

            return resultados
              ? `Pólizas disponibles:\n${resultados}`
              : 'No hay pólizas disponibles.';
          } catch (error) {
            self.logger.error('Error in policyPrices tool', error);
            return 'Error al obtener precios de pólizas. Intente nuevamente.';
          }
        },
      });

      const activityEconomic = tool({
        name: 'activityEconomic',
        description: `Con esta tool le puedes decir al usuario si es independiente o dependiente`,
        parameters: z.object({}),
        execute() {
          return `Dependientes:\n Las personas se afilian como dependientes si, por voluntad propia, desean pagar su seguridad social, o si su empleador les exige tener cobertura de riesgos laborales\n
           Independientes:\n Las personas se afilian como independientes si tienen un contrato con el Estado (por ejemplo, con la Alcaldía, el SENA, la Gobernación, etc.), o si tienen un contrato con una empresa que les exige la planilla de seguridad social bajo su propio nombre. También pueden afiliarse como independientes aquellos que declaran renta.`;
        },
      });

      const about = tool({
        name: 'aboutAfiliamos',
        description: 'Informacion sobre la empresa Afiliamos',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone(
              'Que es afiliamos?',
              ['descripcion'],
              ['text', 'tipo'],
            );

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
            self.logger.error('Error in about tool', error);
            return 'Error al obtener información sobre Afiliamos.';
          }
        },
      });

      const services = tool({
        name: 'servicesAfiliamos',
        description:
          'Busca y devuelve la información de los servicios de Afiliamos. Usa esta herramienta para responder a preguntas como "¿Qué servicios ofrecen?", "¿Dime los productos que tienen?" o "Quiero saber más sobre sus opciones".',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone(
              'servicios',
              ['servicios'],
              ['text', 'tipo'],
            );

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
            self.logger.error('Error in services tool', error);
            return 'Error al obtener servicios disponibles.';
          }
        },
      });

      const risks = tool({
        name: 'risks',
        description:
          'Proporciona la lista de los niveles de riesgo de ARL y sus características. No uses esta herramienta para calcular el nivel de riesgo de un usuario, solo para mostrar la tabla de clasificación. Usa esta herramienta cuando el usuario pregunte por "riesgo", "niveles" de ARL o "clasificación".',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone(
              'Riesgos ARL',
              ['risk'],
              ['text', 'tipo'],
            );

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
            self.logger.error('Error in risks tool', error);
            return 'Error al obtener información sobre riesgos ARL.';
          }
        },
      });

      const form = tool({
        name: 'form',
        description: 'Formulario requerido para afiliación',
        parameters: z.object({}),
        execute(): Promise<string> {
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
            self.logger.error('Error in form tool', error);
            return Promise.resolve(
              'Error al obtener formulario de afiliación.',
            );
          }
        },
      });

      const createUser = tool({
        name: 'createUser',
        description: 'Crea usuario con datos del formulario',
        parameters: z.object({
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
        async execute({
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
        }): Promise<string> {
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
              self.validateInput(params[field], label);
            }

            self.logger.log(`Creating user: ${name}, Doc: ${doc}`);

            const result = await self.dynamoService.crearUsuario(
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

            self.logger.log(`User created successfully: ${name}`);
            return `✅ Usuario ${name} creado exitosamente`;
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : 'Error inesperado';
            self.logger.error(`Error creating user: ${errorMessage}`, error);
            return `❌ Error al crear usuario: ${errorMessage}`;
          }
        },
      });

      const findUser = tool({
        name: 'findUser',
        description: 'Busca un usuario por número de documento',
        parameters: z.object({
          doc: z.string().min(1, 'Documento es requerido'),
        }),
        async execute({ doc }): Promise<string | object> {
          try {
            self.validateInput(doc, 'Documento');
            self.logger.log(`Buscando usuario con documento: ${doc}`);
            const user = await self.dynamoService.findUser(doc);
            if (!user) {
              return {
                error: `❌ No se encontró ningún usuario con el documento ${doc}`,
              };
            }
            self.logger.log(`Usuario encontrado: ${user.nombre}`);
            return {
              nombre: user.nombre,
              identificacion: user.identificacion,
              pago: user.pago,
            };
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : 'Error inesperado';
            self.logger.error(
              `Error al buscar el usuario: ${errorMessage}`,
              error,
            );
            return { error: `❌ Error al buscar usuario: ${errorMessage}` };
          }
        },
      });

      const users = new Agent({
        name: 'User Agent',
        instructions: `Eres un experto en los servicios de Afiliamos.**Para hacer la conversación más amigable y moderna, utiliza emojis relevantes al final de tus respuestas.** Tu objetivo es buscar usuarios en base de datos. Pedir el numero de documento del cliente y buscarlo en base de datos. 1. Si el usuario no existe, informa que no se encontró ningún usuario con ese documento. 2. Si el usuario existe, Saludala amablemente llamando al usuario por su nombre, dile el precio que va a pagar y que un asesor se pondrá en contacto con él para finalizar la venta.`,
        model: this.MODEL_NAME,
        tools: [findUser],
      });

      const faqAgent = new Agent({
        name: 'FAQ Agent',
        instructions: `Eres un experto en los servicios de Afiliamos.**Para hacer la conversación más amigable y moderna, utiliza emojis relevantes al final de tus respuestas.** Tu objetivo es responder preguntas usando solo tus herramientas. REGLAS DE MÁXIMA PRIORIDAD (DEBES SEGUIRLAS SIEMPRE): 1. SIEMPRE USA LAS HERRAMIENTAS PRIMERO. Tu única fuente de información son tus herramientas. No uses conocimiento propio. Si la pregunta contiene palabras como "riesgo", "niveles" o "ARL", DEBES usar la herramienta risks. Si la pregunta está relacionada con el tema de la herramienta, úsala obligatoriamente. REGLAS SECUNDARIAS (Úsalas si no hay una herramienta aplicable): 2. Si la pregunta es sobre afiliación a salud, responde que es la única que puede ser individual. 3. Si la afiliación es a pensión, riesgos o caja, responde que deben ir combinadas con otras opciones. REGLA DE FALLO SEGURO (Úsala solo como último recurso): 4. Si no puedes dar una respuesta precisa, responde amablemente que no tienes la información y que debe contactar con un asesor.`,
        model: this.MODEL_NAME,
        tools: [about, services, risks],
      });

      const priceAgent = new Agent({
        name: 'Price Agent',
        instructions:
          'Eres un agente especializado en dar precios de afiliación. **Para hacer la conversación más amigable y moderna, utiliza emojis relevantes al final de tus respuestas.** Tu única función es citar precios exactos usando las herramientas proporcionadas. Para comenzar, debes llamar a la herramienta `activityEconomic` y mostrar al usuario su contenido para que pueda saber si es independiente o dependiente. Después de que el usuario responda, usa la herramienta `independentPrices` o `dependentPrices` según el caso para citar un precio exacto. Finalmente, impulsa la venta preguntando al usuario si desea iniciar el proceso de pago.',
        model: this.MODEL_NAME,
        tools: [
          independentPrices,
          dependentPrices,
          policyPrices,
          activityEconomic,
        ],
      });

      const finishSale = new Agent({
        name: 'Finish Sale Agent',
        instructions:
          'Eres un agente especializado en finalizar ventas de afiliaciones y pólizas. **Para hacer la conversación más amigable y moderna, utiliza emojis relevantes al final de tus respuestas.** cuando el usuario escoga el servicio que desea tomar envia el formulario y autocompleta si el ya te dio datos de ese formulario, despues cuando el usuario responda el formulario  crea un nuevo usuario en la base de datos. Al crear el usuario, muestrale el servicio que compro con su respectivo valor y  dile que un asesor se pondrá en contacto con él para finalizar la venta.',
        model: this.MODEL_NAME,
        tools: [form, createUser],
      });

      this.orchestratorAgent = new Agent({
        name: 'Orchestrator Agent',
        instructions: `Eres un agente de clasificación. Tu única tarea es dirigir la conversación al agente más adecuado. Reglas estrictas: 1. Si la pregunta es sobre  afiliación, servicios, niveles o riesgos delega al agente de Preguntas Frecuentes. 2. Si la pregunta es exclusivamente sobre precios o costos, delega al agente de Precios. 3. Si el usuario expresa una intención clara de contratar, delega al agente de Finalizar la venta. 4. Si el usuario quiere pagar mensualidad delega al agente de users 5. Nunca respondas directamente.`,
        model: this.MODEL_NAME,
        handoffs: [priceAgent, faqAgent, finishSale, users],
      });
    } catch (error) {
      this.logger.error('Failed to initialize tools', error);
      throw new Error('Error al inicializar herramientas');
    }
  }

  private initializeSynthesizerAgent(): void {
    try {
      this.synthesizerAgent = new Agent({
        name: 'Resumidor de Conversación',
        // Las instrucciones son CRUCIALES para el comportamiento del resumen
        instructions: `
        Por favor, resume la siguiente conversación de chat. Concéntrate solo en:

1.  **Lo que el usuario pide o elige.**
2.  **Los datos específicos que el usuario proporciona.**.

      `,
        model: this.MODEL_NAME,
        tools: [],
      });
      this.logger.log('Synthesizer agent initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize synthesizer agent', error);
      throw new Error('Error al inicializar el agente de síntesis.');
    }
  }

  // Función para obtener el historial de la conversación del usuario
  async getConversationData(
    userId: string,
  ): Promise<{ userHistory: string; actions: any; timestamp: string }> {
    // Obtener los datos de la conversación desde DynamoDB
    const conversationData =
      await this.dynamoService.getConversationHistory(userId);

    // Si no hay datos, devolvemos valores predeterminados
    const userHistory =
      conversationData && typeof conversationData !== 'string'
        ? conversationData.userHistory
        : '';

    const actions =
      conversationData && typeof conversationData !== 'string'
        ? conversationData.actions
        : {};

    const timestamp =
      conversationData && typeof conversationData !== 'string'
        ? conversationData.timestamp
        : '';

    // Retornamos el historial y las acciones
    return { userHistory, actions, timestamp };
  }

  async handleButtonAction(
    payload: payLoad,
    actions: any,
    userHistory: string,
    userId: string,
  ): Promise<sendWhastappResponse | null> {
    // Log de la acción del botón
    this.logger.log(
      `Botón presionado por el usuario: ${JSON.stringify(userHistory)}`,
    );

    // Validación de la respuesta del payload
    const resp = await this.validateMessagePayload(payload, actions);

    // Actualización de las acciones
    const updatedActions = resp.actions
      ? { ...actions, ...resp.actions }
      : { ...actions };

    // Actualización del historial de la conversación
    const updatedUserHistory =
      userHistory + `User: ${payload.text}\nAI: ${resp.text}\n`;

    // Guardar el historial actualizado
    await this.dynamoService.saveConversationHistory(
      userId,
      updatedUserHistory,
      updatedActions,
    );

    // Verificar la acción del botón y devolver la respuesta adecuada
    if (payload.action !== 'Pagar Mensualidad') {
      return {
        type: resp.type === 'plantilla' ? 'plantilla' : 'texto',
        template: resp.template ?? '',
        text: resp.text ?? 'Opción no reconocida. Por favor, intenta de nuevo.',
      };
    }

    // Si la acción es 'Pagar Mensualidad', no se devuelve nada aquí (dependiendo de tu flujo de negocio)
    return null;
  }

  // Función para manejar la verificación de caché
  async handleCacheCheck(
    payload: payLoad,
    userId: string,
    updatedUserHistory: string,
    actions: any,
  ): Promise<sendWhastappResponse | null> {
    // Verificar si el texto del payload tiene menos de 60 caracteres
    if (payload.text && payload.text.length <= 60) {
      // Obtener la respuesta de la caché
      const cachedResponse = await this.semanticCacheService.getAgentResponse(
        payload.text,
      );

      // Si hay respuesta en caché y no es una respuesta del LLM, la usamos
      if (cachedResponse && !cachedResponse.startsWith('[Respuesta del LLM]')) {
        this.logger.log(
          `[Cache Hit] Devolviendo respuesta de la caché para el usuario ${userId}`,
        );

        // Actualizar el historial de la conversación con la respuesta en caché
        updatedUserHistory += `AI: ${cachedResponse}\n`;

        // Guardar el historial actualizado en DynamoDB
        await this.dynamoService.saveConversationHistory(
          userId,
          updatedUserHistory,
          actions,
        );

        // Retornar la respuesta desde la caché
        return { type: 'texto', template: '', text: cachedResponse };
      }
    }

    // Si no se encuentra en caché o no hay texto en el payload, continuar con el flujo
    return null;
  }

  // Función para procesar la respuesta del Orquestador
  async processOrchestratorResponse(
    updatedUserHistory: string,
    currentUserMessage: string,
    userId: string,
    actions: any,
  ): Promise<string> {
    let agentResponse = 'Lo siento, no pude procesar tu solicitud.';
    let finalAgentOutput = '';

    await withTrace('Orchestrator evaluator', async () => {
      try {
        // Ejecutar el Orquestador
        const orchestratorResult = await run(
          this.orchestratorAgent,
          updatedUserHistory,
        );

        // Registro de pasos intermedios del orquestador
        orchestratorResult.newItems.forEach((item) => {
          if (item.type === 'message_output_item' && item.content) {
            this.logger.debug(`  - paso: ${item.content}`);
          }
        });

        // Obtener la respuesta final del orquestador
        finalAgentOutput = orchestratorResult.finalOutput;
        agentResponse = finalAgentOutput;

        // Si el historial excede el tamaño máximo, sintetizarlo
        const MAX_HISTORY_LENGTH = 1000;
        if (updatedUserHistory.length > MAX_HISTORY_LENGTH) {
          try {
            // Ejecutar el sintetizador para resumir la conversación
            const synthesizerResult = await run(
              this.synthesizerAgent,
              `${updatedUserHistory}\n\nPor favor, resume esta conversación de forma concisa, centrándote en las solicitudes del usuario, sus elecciones, precio y los datos que ha proporcionado. Omite saludos genéricos y detalles internos del asistente.`,
            );
            const summarizedContent = synthesizerResult.finalOutput;
            updatedUserHistory = `Resumen de la conversación anterior: ${summarizedContent}\n${currentUserMessage}AI: ${finalAgentOutput}\n`;
            this.logger.log(
              `Synthesized history updated for user ${userId}: ${updatedUserHistory}`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to summarize conversation history for user ${userId}:`,
              error,
            );
            updatedUserHistory += `AI: ${finalAgentOutput}\n`;
          }
        } else {
          updatedUserHistory += `AI: ${finalAgentOutput}\n`;
        }
      } catch (error) {
        this.logger.error(
          `Failed to run orchestrator agent for user ${userId}:`,
          error,
        );
        agentResponse =
          'Lo siento, ha ocurrido un error al procesar tu solicitud. Inténtalo de nuevo más tarde.';
        finalAgentOutput = agentResponse;
        updatedUserHistory += `AI: ${agentResponse}\n`;
      } finally {
        // Guardar el historial actualizado
        await this.dynamoService.saveConversationHistory(
          userId,
          updatedUserHistory,
          actions,
        );
      }
    });

    return agentResponse; // Devolver la respuesta final del agente
  }

  async hablar(
    userId: string,
    payload: payLoad,
  ): Promise<sendWhastappResponse> {
    const { userHistory, actions, timestamp } =
      await this.getConversationData(userId);
    const currentTime = new Date().getTime();
    const lastMessageTime = userHistory ? new Date(timestamp).getTime() : 0;
    const timeDifference = (currentTime - lastMessageTime) / 1000 / 60;

    const currentUserMessage = `User: ${payload.text}\n`;
    let updatedUserHistory = userHistory;

    if (timeDifference > 5 || !userHistory) {
      // Si han pasado más de 10 minutos o no hay historial, iniciar nueva conversación
      const updatedUserHistory = `AI: Hola Bienvenido a Afiliamos\n`;

      // Guardar el historial actualizado en la base de datos
      await this.dynamoService.saveConversationHistory(
        userId,
        updatedUserHistory,
        actions,
      );

      // Retornar respuesta con plantilla de bienvenida
      return { type: 'plantilla', template: 'bienvenida_inicial', text: '' };
    }

    if (payload.type === 'button') {
      const buttonResponse = await this.handleButtonAction(
        payload,
        actions,
        userHistory,
        userId,
      );
      if (buttonResponse) return buttonResponse;
    }

    updatedUserHistory += currentUserMessage;

    const cacheResponse = await this.handleCacheCheck(
      payload,
      userId,
      updatedUserHistory,
      actions,
    );
    if (cacheResponse) return cacheResponse;

    const agentResponse = await this.processOrchestratorResponse(
      updatedUserHistory,
      currentUserMessage,
      userId,
      actions,
    );

    return { type: 'texto', template: '', text: agentResponse };
  }

  private async validateMessagePayload(
    payload: payLoad,
    actions: any,
  ): Promise<payLoad> {
    switch (payload.action) {
      case 'Independiente':
        return {
          type: 'plantilla',
          template: 'servicioindependientes',
          text: 'Mostrar servicios independientes',
          actions: {
            services: 'Independientes',
            activityEconomic: 'Independientes',
          },
        };

      case 'Dependiente':
        return {
          type: 'plantilla',
          template: 'serviciosdependientes',
          text: 'Mostrar servicios dependientes',
          actions: {
            services: 'Dependiente',
            activityEconomic: 'Dependiente',
          },
        };
      case 'Precios Seguridad Social': {
        return {
          type: 'plantilla',
          template: 'economicactivity',
          text: 'Mostrar actividad económica',
          actions: {
            services: 'Seguridad Social',
            activityEconomic: '',
          },
        };
      }

      case 'Salud': {
        const resp = await this.dynamoService.findPrices(`salud1`, 1);
        return {
          type: 'text',
          template: '',
          text: resp,
        };
      }
      case 'Salud,Riesgo':
        if (actions.activityEconomic === 'Independientes') {
          const resp = await this.dynamoService.findPrices(`salud,riesgo2`, 2);
          return {
            type: 'text',
            template: '',
            text: resp,
          };
        } else {
          const resp = await this.dynamoService.findPrices(`salud,riesgo1`, 1);
          return {
            type: 'text',
            template: '',
            text: resp,
          };
        }
      case 'Salud,Riesgo,Pensión':
      case 'Salud,Riesgo,Pension':
        if (actions.activityEconomic === 'Independientes') {
          const resp = await this.dynamoService.findPrices(
            `salud,riesgo,pension2`,
            2,
          );
          return {
            type: 'text',
            template: '',
            text: resp,
          };
        } else {
          const resp = await this.dynamoService.findPrices(
            `salud,riesgo,pension1`,
            1,
          );
          return {
            type: 'text',
            template: '',
            text: resp,
          };
        }
      case 'Salud,Riesgo,Caja': {
        const resp = await this.dynamoService.findPrices(
          `salud,riesgo,caja1`,
          1,
        );
        return {
          type: 'text',
          template: '',
          text: resp,
        };
      }
      case 'Salud,Riesgo,Pension,Caja': {
        const resp = await this.dynamoService.findPrices(
          `salud,riesgo,pension,caja1`,
          1,
        );
        return {
          type: 'text',
          template: '',
          text: resp,
        };
      }
      case 'Polizas Incapacidad': {
        const resp = await this.dynamoService.findPolicies(`poliza`);
        return {
          type: 'text',
          template: '',
          text: resp,
        };
      }
      default: {
        return {
          type: 'text',
          template: '',
          text: 'Flujo no encontrado',
        };
      }
    }
  }
}
