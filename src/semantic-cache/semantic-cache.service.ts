/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pinecone } from '@pinecone-database/pinecone';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class SemanticCacheService implements OnModuleInit {
  private readonly logger = new Logger(SemanticCacheService.name);
  private openai!: OpenAI;
  private pineconeNamespace: any;
  private pineconeTrackingNamespace: any;
  private readonly INDEX_NAME = 'cacheafiliamos';
  private readonly NAMESPACE = 'semantic-cache';
  private readonly NAMESPACE_TRACKING = 'query-tracking';
  private readonly DIMENSIONS = 1024;
  private readonly SIMILARITY_THRESHOLD = 0.85;
  private readonly TRACKING_THRESHOLD = 0.75;
  private readonly REPETITION_THRESHOLD = 5;

  constructor(private config: ConfigService) {
    this.validateEnvironmentVariables();
  }

  onModuleInit() {
    try {
      this.initializePinecone();
      this.initializeOpenAI();
    } catch (error) {
      this.logger.error('Failed to initialize agent service', error);
      throw new Error('Failed to initialize agent service');
    }
  }

  private validateEnvironmentVariables(): void {
    const requiredVars = [
      'OPENAI_API_KEY',
      'PINECONE_API_KEY',
      'PINECONE_CACHE',
      'PINECONE_HOST_CACHE',
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
      const pineconeIndex = this.config.get<string>('PINECONE_CACHE');
      const pineconeHost = this.config.get<string>('PINECONE_HOST_CACHE');
      const pc = new Pinecone({
        apiKey: pineconeApiKey!,
      });
      this.pineconeNamespace = pc
        .index(pineconeIndex as string, pineconeHost as string)
        .namespace(this.NAMESPACE);
      this.pineconeTrackingNamespace = pc
        .index(pineconeIndex as string, pineconeHost as string)
        .namespace(this.NAMESPACE_TRACKING);
      this.logger.log('Pinecone initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Pinecone', error);
      throw new Error('Error al inicializar Pinecone');
    }
  }

  private initializeOpenAI(): void {
    try {
      const openAIApiKey = this.config.get<string>('OPENAI_API_KEY');
      this.openai = new OpenAI({
        apiKey: openAIApiKey,
      });
      this.logger.log('OpenAI initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI', error);
      throw new Error('Error al inicializar OpenAI');
    }
  }
  private normalizeAndClean(text: string): string {
    // 1. Elimina tildes
    const withoutAccents = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    // 2. Elimina caracteres no alfanuméricos (manteniendo espacios y guiones)
    const cleaned = withoutAccents.replace(/[^\w\s-]/g, '');
    // 3. Reemplaza espacios con guiones
    return cleaned.replace(/\s/g, '-');
  }

  private async getEmbedding(text: string): Promise<number[]> {
    this.logger.log(`Generating embedding for text: "${text}"`);
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: this.DIMENSIONS,
    });
    return response.data[0].embedding;
  }

  public async getAgentResponse(query: string): Promise<string> {
    if (!query) {
      return 'Por favor, ingresa una pregunta.';
    }

    this.logger.log(`Received query: "${query}"`);

    const cachedResponse = await this.queryCache(query);
    if (cachedResponse) {
      this.logger.log('✅ Found in semantic cache. Returning cached response.');
      return cachedResponse;
    }
    this.logger.log('❌ Not found in cache. Calling main AI agent...');
    return this.callLLMAgent(query);
  }

  private async queryCache(queryText: string): Promise<string | null> {
    try {
      const queryEmbedding = await this.getEmbedding(queryText);
      const queryResponse = await this.pineconeNamespace.query({
        vector: queryEmbedding,
        topK: 1,
        includeMetadata: true,
      });

      if (queryResponse.matches.length > 0) {
        const match = queryResponse.matches[0];
        this.logger.log('Mejor coincidencia:', match.metadata.text);
        this.logger.log('Nivel de coincidencia:', match.score);
        if (match.score > this.SIMILARITY_THRESHOLD) {
          return match.metadata.text as string;
        }
      }
      return null;
    } catch (error) {
      this.logger.error('Error querying Pinecone:', error);
      return null;
    }
  }

  private async callLLMAgent(query: string): Promise<string> {
    this.logger.log(`Sending "${query}" to the main LLM agent...`);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simula un delay
    return `[Respuesta del LLM]: No encontré una respuesta en la caché para "${query}", pero puedo procesar tu pregunta.`;
  }

  public async addEntry(question: string, response: string): Promise<void> {
    if (
      !question ||
      question.trim() === '' ||
      !response ||
      response.trim() === ''
    ) {
      this.logger.warn(
        '🚫 Entrada de caché omitida: La pregunta o la respuesta están vacías o no son válidas.',
      );
      return;
    }

    try {
      this.logger.log('Adding new Q&A entry to Pinecone...', {
        question,
        response,
      });

      // Limpiamos la pregunta para crear un ID único y consistente
      const cleanedQuestion = this.normalizeAndClean(question);
      const id = cleanedQuestion + '-' + Date.now().toString();

      // Creamos un solo texto que combina la pregunta y la respuesta
      const textToEmbed = question;

      // Generamos el embedding para el par completo
      const embedding = await this.getEmbedding(textToEmbed);

      // Subimos el vector a Pinecone con los metadatos
      await this.pineconeNamespace.upsert([
        {
          id: id,
          values: embedding,
          metadata: {
            text: response,
            type: 'agent-generated',
          },
        },
      ]);
      this.logger.log(`✅ Entry added to cache with ID: ${id}`);
    } catch (error) {
      this.logger.error('Error adding entry to cache:', error);
    }
  }

  public async trackAndCache(
    question: string,
    response: string,
  ): Promise<void> {
    try {
      if (
        !question ||
        question.trim() === '' ||
        !response ||
        response.trim() === ''
      ) {
        this.logger.warn(
          '🚫 Omitiendo rastreo y caché: La pregunta o la respuesta son inválidas.',
        );
        return;
      }

      const embedding = await this.getEmbedding(question);
      const cleanedQuestion = this.normalizeAndClean(question);

      const queryResponse = await this.pineconeTrackingNamespace.query({
        vector: embedding,
        topK: 5,
        includeMetadata: true,
      });
      this.logger.debug(
        `Consulta a Pinecone: ${JSON.stringify(queryResponse)}`,
      );

      if (
        queryResponse.matches.length > 0 &&
        queryResponse.matches[0].score > this.TRACKING_THRESHOLD
      ) {
        const match = queryResponse.matches[0];
        // --- CÓDIGO CORREGIDO AQUÍ ---
        // Usa 'metadata' en lugar de 'setMetadata'
        const updatedMetadata = {
          ...match.metadata,
          count: ((match.metadata.count as number) || 0) + 1,
        };

        await this.pineconeTrackingNamespace.update({
          id: match.id,
          metadata: updatedMetadata,
        });

        const newCount = updatedMetadata.count as number;
        this.logger.debug(
          `Pregunta similar encontrada. Nuevo conteo: ${newCount}`,
        );
        // --- FIN DEL CÓDIGO CORREGIDO ---
        this.logger.log(typeof newCount, 'Nuevo conteo:', newCount);
        this.logger.log(
          typeof this.REPETITION_THRESHOLD,
          'Nuevo REPETITION_THRESHOLD:',
          this.REPETITION_THRESHOLD,
        );
        if (newCount >= this.REPETITION_THRESHOLD) {
          this.logger.log(
            `📈 Pregunta "${question}" alcanzó el umbral. Añadiendo a la caché principal.`,
          );
          await this.addEntry(question, response);
        }
      } else {
        this.logger.debug('Pregunta nueva. Creando nuevo registro de rastreo.');
        const newId = cleanedQuestion + '-' + Date.now().toString();
        await this.pineconeTrackingNamespace.upsert([
          {
            id: newId,
            values: embedding,
            metadata: { question: question, count: 1 },
          },
        ]);
      }
    } catch (error) {
      this.logger.error('Error en el proceso de rastreo y caché:', error);
    }
  }
}
