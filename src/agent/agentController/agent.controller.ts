import { Controller } from '@nestjs/common';
import { Post, Body } from '@nestjs/common';
import { PruebaService } from '../agent.service';
import { AgentOpenIaService } from '../agent-open-ia/agent-open-ia.service';

@Controller('prueba')
export class PruebaController {
  constructor(
    private readonly chatbotService: PruebaService,
    private readonly agentOpenIAService: AgentOpenIaService,
    private readonly pruebaService: PruebaService,
  ) {}

  @Post('chat')
  async handleMessage(
    @Body('message') message: string,
    @Body('threadId') threadId: string,
  ) {
    //const reply = await this.chatbotService.conversar(threadId, message);
    //console.log('Received message:', message, 'in thread:', threadId);
    const reply = await this.agentOpenIAService.hablar(threadId, message);
    return { reply: reply };
  }

  @Post('end')
  async endConversation(@Body('threadId') threadId: string) {
    await this.pruebaService.finalizeConversation(threadId);
    return { success: true, message: `Conversation ${threadId} finalized.` };
  }
}
