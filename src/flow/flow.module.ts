import { Module } from '@nestjs/common';
import { FlowController } from './flow/flow.controller';
import { FlowService } from './flow/flow.service';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [FlowController],
  providers: [FlowService],
})
export class FlowModule {}
