import { Module } from '@nestjs/common';
import { BulkMessagingController } from './bulk-messaging/bulk-messaging.controller';
import { BulkMessagingService } from './bulk-messaging/bulk-messaging.service';
import { DatabaseModule } from 'src/database/database.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';

@Module({
  imports: [DatabaseModule, WhatsappModule],
  controllers: [BulkMessagingController],
  providers: [BulkMessagingService],
})
export class BulkMessagingModule {}
