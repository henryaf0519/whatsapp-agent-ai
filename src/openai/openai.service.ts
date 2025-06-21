/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
import { OpenAI } from 'openai';

@Injectable()
export class OpenaiService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
  }

  async getAIResponse(message: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `
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
      `,
        },
        {
          role: 'user',
          content: message, // El mensaje del usuario
        },
      ],
    });

    return response.choices[0]?.message.content ?? '';
  }
}
