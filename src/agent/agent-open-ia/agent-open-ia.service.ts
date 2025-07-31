/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  Agent,
  tool,
  run,
  setDefaultOpenAIKey,
  withTrace,
} from '@openai/agents';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { Pinecone } from '@pinecone-database/pinecone';

interface PineconeSearchResult {
  fields?: { text?: string; tipo?: string };
}

@Injectable()
export class AgentOpenIaService implements OnModuleInit {
  private readonly logger = new Logger(AgentOpenIaService.name);
  private agent!: any;
  private orchestratorAgent!: any;
  private synthesizerAgent!: any;
  private readonly MODEL_NAME = 'gpt-4o-mini';
  private pineconeNamespace: any = null;
  private conversationHistories: Map<string, string> = new Map();

  constructor(
    private config: ConfigService,
    private readonly dynamoService: DynamoService,
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
      const self = this;
      const membershipPrices = tool({
        name: 'membershipPrices',
        description: 'Obtiene precios de afiliaciones disponibles',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone('membershipPrices', [
              'membershipPrices',
            ]);

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
            const hits = await self.searchPinecone('policyPrices', [
              'policyPrices',
            ]);

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

      const about = tool({
        name: 'aboutAfiliamos',
        description: 'Información sobre la empresa Afiliamos',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone('Que es afiliamos?', [
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
            self.logger.error('Error in about tool', error);
            return 'Error al obtener información sobre Afiliamos.';
          }
        },
      });

      const services = tool({
        name: 'servicesAfiliamos',
        description: 'Servicios ofrecidos por Afiliamos',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone('servicios', ['servicios']);

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
        description: 'Información sobre niveles de riesgo ARL',
        parameters: z.object({}),
        async execute(): Promise<string> {
          try {
            const hits = await self.searchPinecone('Riesgos ARL', ['risk']);

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
      this.orchestratorAgent = new Agent({
        name: 'Asistente de afiliaciones',
        instructions: `
          Eres un asistente de afiliamos que puede usar las herramientas para ayudar a los usuarios.:
          Saluda, pregunta por servicios, muestra precios, solicita formulario cuando elijan servicio, confirma que asesor contactará para pago.
          **Consideraciones Adicionales:**
          - Siempre prioriza la última intención del usuario.
          - Si el historial de conversación ha sido resumido (lo verás al inicio), utiliza el resumen y la última interacción para mantener el contexto. No reinicies la conversación si ya se ha avanzado en el proceso.
 
        `,
        model: this.MODEL_NAME,
        tools: [
          membershipPrices,
          policyPrices,
          about,
          services,
          risks,
          form,
          createUser,
        ],
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

  async hablar(userId: string, message: string): Promise<string> {
    let userHistory =
      (await this.dynamoService.getConversationHistory(userId)) || '';

    const currentUserMessage = `User: ${message}`;
    userHistory += currentUserMessage + '\n';
    let agentResponse = 'Lo siento, no pude procesar tu solicitud.';
    let actualAgentFinalOutput = '';

    await withTrace('Orchestrator evaluator', async () => {
      const orchestratorResult = await run(this.orchestratorAgent, userHistory);
      for (const item of orchestratorResult.newItems) {
        if (item.type === 'message_output_item') {
          const text = item.content;
          if (text) {
            this.logger.debug(`  - paso: ${text}`);
          }
        }
      }
      actualAgentFinalOutput = orchestratorResult.finalOutput;
      agentResponse = actualAgentFinalOutput;
      const MAX_HISTORY_LENGTH = 2000;
      if (userHistory.length > MAX_HISTORY_LENGTH) {
        try {
          const synthesizerResult = await run(
            this.synthesizerAgent,
            userHistory +
              '\n\n' +
              'Por favor, resume esta conversación de forma concisa, centrándote en las solicitudes del usuario, sus elecciones y los datos que ha proporcionado. Omite saludos genéricos y detalles internos del asistente.',
          );
          const summarizedContent = synthesizerResult.finalOutput;

          userHistory = `Resumen de la conversación anterior: ${summarizedContent}\n${currentUserMessage}\nAI: ${actualAgentFinalOutput}\n`;
          this.logger.log(
            `Synthesized history updated for user ${userId}: ${userHistory}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to summarize conversation history for user ${userId}:`,
            error,
          );
        }
      } else {
        userHistory += `AI: ${actualAgentFinalOutput}\n`;
      }

      await this.dynamoService.saveConversationHistory(userId, userHistory);
    });

    return agentResponse;
  }
}
