import { forwardRef, Module } from '@nestjs/common';
import { DynamoService } from './dynamo/dynamo.service';
import { DynamoController } from './dynamo/dynamo.controller';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { ConversationLogModule } from 'src/conversation-log/conversation-log.module';

@Module({
  imports: [forwardRef(() => WhatsappModule), ConversationLogModule],
  providers: [DynamoService],
  controllers: [DynamoController],
  exports: [DynamoService],
})
export class DatabaseModule {}
