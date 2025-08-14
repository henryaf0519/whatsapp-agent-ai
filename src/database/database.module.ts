import { Module } from '@nestjs/common';
import { DynamoService } from './dynamo/dynamo.service';
import { DynamoController } from './dynamo/dynamo.controller';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

@Module({
  providers: [DynamoService, WhatsappService],
  controllers: [DynamoController],
  exports: [DynamoService],
})
export class DatabaseModule {}
