import { forwardRef, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ConversationLogModule } from '../conversation-log/conversation-log.module';
import { DatabaseModule } from 'src/database/database.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [
    ConversationLogModule,
    forwardRef(() => DatabaseModule),
    RedisModule,
  ],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
