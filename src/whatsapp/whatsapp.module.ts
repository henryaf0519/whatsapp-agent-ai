import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ConversationLogModule } from '../conversation-log/conversation-log.module';

@Module({
  imports: [ConversationLogModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
