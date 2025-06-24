// src/openai/openai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChatMessage } from '../common/interfaces/chat-message';

@Injectable()
export class OpenaiService {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly logger = new Logger(OpenaiService.name);
  private readonly mcpClient = new McpClient({
    name: 'whatsapp-ia-client',
    version: '1.0.0',
  });

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.error('OPENAI_API_KEY no configurada');
      throw new Error('OPENAI_API_KEY is not configured');
    }
    this.openai = new OpenAI({ apiKey });
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  /** Llamar tras app.listen() en main.ts */
  public async initializeMcpClient() {
    await this.mcpClient.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')),
    );
    this.logger.log('MCP Client conectado a http://localhost:3000/mcp');
  }

  /**
   * Genera la respuesta de IA, inyectando el historial en el prompt.
   */
  async getAIResponse(
    userMessage: string,
    chatHistory: ChatMessage[],
  ): Promise<string> {
    // 1) Construir un string con el historial + nuevo mensaje
    const historyText = chatHistory
      .map(
        (m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`,
      )
      .join('\n');
    const fullInput = historyText
      ? `${historyText}\nUsuario: ${userMessage}`
      : userMessage;

    // 2) Obtener el prompt 'route' pasando fullInput
    const prompt = await this.mcpClient.getPrompt({
      name: 'route',
      arguments: { userInput: fullInput },
    });

    // 3) Mapear al formato que espera OpenAI
    const messagesToSend = prompt.messages.map((m) => {
      if (m.content.type === 'text') {
        return { role: m.role, content: m.content.text };
      }
      throw new Error(`Tipo de contenido no soportado: ${m.content.type}`);
    }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    // 4) Llamar al modelo
    const resp = await this.openai.chat.completions.create({
      model: this.model,
      messages: messagesToSend,
      temperature: 0,
    });
    const content = resp.choices[0]?.message.content?.trim() ?? '';

    // 5) Si devuelve JSON → tool_call, sino conversación
    try {
      const { method, params } = JSON.parse(content) as {
        method: string;
        params: any;
      };
      this.logger.log(
        `Invocando herramienta ${method} con ${JSON.stringify(params)}`,
      );
      const result = await this.mcpClient.callTool({
        name: method,
        arguments: params,
      });
      // Extraer texto del resultado
      const out = result.content?.[0];
      if (
        out &&
        typeof out === 'object' &&
        !('message' in out) && // crude check to avoid error objects
        'text' in out &&
        typeof (out as object) &&
        out !== null &&
        'text' in out &&
        typeof (out as { text?: unknown }).text === 'string'
      ) {
        return (out as { text: string }).text;
      }
      return '';
    } catch {
      return content;
    }
  }
}
