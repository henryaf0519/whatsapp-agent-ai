import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { ChatMessage } from '../common/interfaces/chat-message';
import { tools } from './prompts/tools';
import { systemPrompt } from './prompts/system-prompt';
@Injectable()
export class OpenaiService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly logger = new Logger(OpenaiService.name);
  private readonly tools: ChatCompletionTool[] = tools;
  private readonly systemPrompt: string = systemPrompt;

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
