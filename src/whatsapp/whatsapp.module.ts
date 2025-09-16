import { forwardRef, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ConversationLogModule } from '../conversation-log/conversation-log.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [ConversationLogModule, forwardRef(() => DatabaseModule)],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
