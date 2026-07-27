import { Module } from '@nestjs/common';
import { FlowController } from './flow/flow.controller';
import { FlowService } from './flow/flow.service';
import { DatabaseModule } from 'src/database/database.module';
import { SocketModule } from 'src/socket/socket.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { FlowTriggerController } from './flow/flow-trigger.controller';
import { FlowTriggerService } from './flow/flow-trigger.service';
import { CalendarModule } from 'src/calendar/calendar.module';
import { QuotationModule } from 'src/quotation/quotation.module';
import { FlowCryptoService } from './flow/flow-crypto.service';

@Module({
  imports: [DatabaseModule, SocketModule, WhatsappModule, CalendarModule, QuotationModule],
  controllers: [FlowController, FlowTriggerController],
  providers: [FlowService, FlowTriggerService, FlowCryptoService],
})
export class FlowModule {}
