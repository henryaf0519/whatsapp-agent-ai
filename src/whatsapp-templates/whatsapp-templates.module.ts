import { Module } from '@nestjs/common';
import { WhatsappTemplatesController } from './whatsapp-templates.controller';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

@Module({
  imports: [WhatsappModule],
  providers: [WhatsappTemplatesService],
  controllers: [WhatsappTemplatesController],
})
export class WhatsappTemplatesModule {}
