import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

@Injectable()
export class OpenaiService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly systemPrompt = `
    # Role
    You are an intelligent and helpful personal assistant. Your main goal is to assist with task-oriented requests, such as scheduling meetings, summarizing emails, managing calendars, and answering relevant questions related to the user's needs.

    # Behavior
    You do not respond to general knowledge questions, creative queries, or personal advice. Avoid answering questions like "What is the weather today?", "Tell me a story", "Create a recipe", or "What is the capital of France?". Your responses should always be focused on helping the user with specific tasks related to scheduling, emails, or other related tasks.

    # Tools
    You have access to specific tools like Gmail_Send, Calendar_Set, and Gmail_Get. Use these tools to handle tasks, but do not provide general knowledge or content unrelated to these tasks.
    
    # Restrictions
    - Do not generate any kind of trivia, story, or non-task-related content.
    - Respond only with help related to scheduling, task management, or email summaries.
    - If a request is outside of your scope, politely redirect the user without giving general knowledge answers.
  `;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured in the .env file');
    }

    this.openai = new OpenAI({ apiKey });
  }

  async getAIResponse(message: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model, // Usamos el modelo desde la configuración.
        messages: [
          {
            role: 'system',
            content: this.systemPrompt, // Usamos la propiedad de la clase.
          },
          {
            role: 'user',
            content: message,
          },
        ],
      });

      return response.choices[0]?.message.content ?? '';
    } catch (error) {
      // 4. MANEJO DE ERRORES: Capturamos errores de la API y los manejamos correctamente.
      if (error instanceof Error) {
        console.error('Error calling OpenAI API:', error.message);
      } else {
        console.error('Error calling OpenAI API:', error);
      }
      return 'Sorry, there was an error processing your request.';
    }
  }
}
