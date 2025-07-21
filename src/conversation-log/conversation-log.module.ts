import { Module } from '@nestjs/common';
import { S3ConversationLogService } from './s3-conversation-log.service';

@Module({
  providers: [S3ConversationLogService],
  exports: [S3ConversationLogService],
})
export class ConversationLogModule {}
