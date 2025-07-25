import { Module } from '@nestjs/common';
import { DynamoService } from './dynamo/dynamo.service';
import { DynamoController } from './dynamo/dynamo.controller';

@Module({
  providers: [DynamoService],
  controllers: [DynamoController],
  exports: [DynamoService],
})
export class DatabaseModule {}
