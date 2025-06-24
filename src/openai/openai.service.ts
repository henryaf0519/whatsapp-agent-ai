import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');

    if (!apiKey) {
      this.logger.error(
        'OPENAI_API_KEY no está configurada en el archivo .env',
      );
      throw new Error('OPENAI_API_KEY is not configured in the .env file');
    }

    this.openai = new OpenAI({ apiKey });
  }
  public async initializeMcpClient() {
    await this.mcpClient.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')),
    );
    this.logger.log('MCP Client conectado a http://localhost:3000/mcp');
  }
  async getAIResponse(userMessage: string): Promise<string> {
    // 1) Pide el prompt con el manifiesto y las reglas
    const prompt = await this.mcpClient.getPrompt({
      name: 'route',
      arguments: { userInput: userMessage },
    });

    const messagesToSend = prompt.messages.map((m) => {
      if (m.content.type === 'text') {
        return { role: m.role, content: m.content.text };
      }
      throw new Error(`Tipo de contenido no soportado: ${m.content.type}`);
    }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    // 2) Llama al modelo con esos mensajes
    const resp = await this.openai.chat.completions.create({
      model: this.model,
      messages: messagesToSend,
      temperature: 0,
    });
    const content = resp.choices[0]?.message.content?.trim() ?? '';
    // 3) Intenta parsear JSON. Si no es válido, es texto conversacional:
    interface Call {
      method: string;
      params: any;
    }
    let call: Call;
    try {
      call = JSON.parse(content) as Call;
    } catch {
      // No JSON → faltan datos o pregunta conversacional
      return content;
    }

    this.logger.log(
      `Llamando a la herramienta ${call.method} con parámetros: ${JSON.stringify(call.params)}`,
    );
    const result = await this.mcpClient.callTool({
      name: call.method,
      arguments: call.params,
    });

    // 5) Devuelve la respuesta de la herramienta
    if (
      result &&
      Array.isArray(result.content) &&
      result.content.length > 0 &&
      typeof result.content[0] === 'object' &&
      result.content[0] !== null &&
      'text' in result.content[0]
    ) {
      return (result.content[0] as { text: string }).text ?? '';
    } else if (result && result.error) {
      this.logger.error(
        `Error al llamar a la herramienta ${call.method}: ${JSON.stringify(result.error)}`,
      );
      return `Error: ${JSON.stringify(result.error)}`;
    }
    return '';
  }
}
