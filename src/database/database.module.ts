import { Module } from '@nestjs/common';
import { DynamoService } from './dynamo/dynamo.service';
import { DynamoController } from './dynamo/dynamo.controller';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { S3ConversationLogService } from 'src/conversation-log/s3-conversation-log.service';

@Module({
  providers: [DynamoService, WhatsappService, S3ConversationLogService],
  controllers: [DynamoController],
  exports: [DynamoService],
})
export class DatabaseModule {}
