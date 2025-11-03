import { Module } from '@nestjs/common';
import { FlowController } from './flow/flow.controller';
import { FlowService } from './flow/flow.service';
import { DatabaseModule } from 'src/database/database.module';
import { SocketModule } from 'src/socket/socket.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';

@Module({
  imports: [DatabaseModule, SocketModule, WhatsappModule],
  controllers: [FlowController],
  providers: [FlowService],
})
export class FlowModule {}
