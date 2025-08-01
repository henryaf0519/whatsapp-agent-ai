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
  private readonly INDEX_NAME = 'cacheafiliamos';
  private readonly NAMESPACE = 'semantic-cache';
  private readonly DIMENSIONS = 1024;
  private readonly SIMILARITY_THRESHOLD = 0.85;

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

  private async getEmbedding(text: string): Promise<number[]> {
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
}
