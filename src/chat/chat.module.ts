import { Module } from '@nestjs/common';
import { ChatController } from './chat/chat.controller';
import { AgentService } from 'src/langchain/agent/agent.service';

@Module({
  controllers: [ChatController],
  providers: [AgentService],
})
export class ChatModule {}
