import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChatMessage } from '../common/interfaces/chat-message';

@Injectable()
export class OpenaiService {
  private openai: OpenAI;
  private model: string;
  private logger = new Logger(OpenaiService.name);
  private mcpClient = new McpClient({
    name: 'whatsapp-ia-client',
    version: '1.0.0',
  });

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (!key) throw new Error('OPENAI_API_KEY no configurada');
    this.openai = new OpenAI({ apiKey: key });
    this.model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  /** Llamar desde main.ts DESPUÉS de app.listen(...) */
  async initializeMcpClient() {
    await this.mcpClient.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')),
    );
    this.logger.log('MCP Client conectado a http://localhost:3000/mcp');
  }

  /**
   * Genera la respuesta:
   *  - Construye input con historial
   *  - Pide prompt 'route'
   *  - Llama a OpenAI
   *  - Si devuelve JSON-RPC invoca la herramienta y devuelve sólo el texto
   *  - Si no, devuelve el texto conversacional
   */
  async getAIResponse(
    userMessage: string,
    chatHistory: ChatMessage[],
  ): Promise<string> {
    // 1) Historial + mensaje
    const histText = chatHistory
      .map(
        (m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`,
      )
      .join('\n');
    const fullInput = histText
      ? `${histText}\nUsuario: ${userMessage}`
      : userMessage;

    // 2) Prompt MCP
    const prompt = await this.mcpClient.getPrompt({
      name: 'route',
      arguments: { userInput: fullInput },
    });

    // 3) OpenAI
    const msgs = prompt.messages.map((m) => {
      if (m.content.type === 'text') {
        return { role: m.role, content: m.content.text };
      }
      throw new Error(`Tipo de contenido no soportado: ${m.content.type}`);
    }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    const resp = await this.openai.chat.completions.create({
      model: this.model,
      messages: msgs,
      temperature: 0,
    });
    const raw = resp.choices[0]?.message.content?.trim() ?? '';

    const candidate = raw
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();
    this.logger.log(`Respuesta de OpenAI (candidate): ${candidate}`);
    try {
      const { method, params } = JSON.parse(candidate) as {
        method: string;
        params: Record<string, any>;
      };
      const result = await this.mcpClient.callTool({
        name: method,
        arguments: params,
      });
      const first = result.content?.[0];
      if (first && typeof first === 'object' && 'text' in first) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
        return first.text;
      }
      return 'Acción completada.';
    } catch {
      // 5) No era JSON, devuelvo la conversación
      return raw;
    }
  }
}
