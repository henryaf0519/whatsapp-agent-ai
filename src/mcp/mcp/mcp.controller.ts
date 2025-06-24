import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { McpService } from './mcp.service';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Post()
  async handleMcp(@Req() req: Request, @Res() res: Response) {
    // 1) Obtén una instancia de tu MCP Server con todas las herramientas y prompts
    const server = this.mcpService.getServer();

    // 2) Crea un transporte HTTP stateless
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // 3) Cuando se cierre la conexión limpia recursos
    res.on('close', () => {
      transport.close();
      server.close();
    });

    // 4) Conecta el servidor al transporte…
    await server.connect(transport);

    // 5) …y atiende la petición JSON-RPC que viene en el body
    await transport.handleRequest(req, res, req.body);
  }
}
