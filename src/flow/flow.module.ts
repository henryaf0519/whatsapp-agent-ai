import { Module } from '@nestjs/common';
import { FlowController } from './flow/flow.controller';
import { FlowService } from './flow/flow.service';

@Module({
  controllers: [FlowController],
  providers: [FlowService]
})
export class FlowModule {}
