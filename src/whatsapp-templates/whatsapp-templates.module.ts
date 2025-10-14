import { Module } from '@nestjs/common';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';

@Module({
  providers: [],
  controllers: [WhatsappTemplatesController],
})
export class WhatsappTemplatesModule {}
