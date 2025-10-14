import { Module } from '@nestjs/common';
import { WhatsappTemplatesService } from './whatsapp-templates.service';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';

@Module({
  providers: [WhatsappTemplatesService],
  controllers: [WhatsappTemplatesController],
})
export class WhatsappTemplatesModule {}
