import { Controller, Post, Body } from '@nestjs/common';
import { AgentService } from '../../langchain/agent/agent.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly agent: AgentService) {}

  @Post()
  async chat(@Body('message') message: string) {
    const reply = await this.agent.handleMessage(message);
    return { reply };
  }
}
