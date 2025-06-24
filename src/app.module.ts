import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { OpenaiService } from './openai/openai.service';
import { WhatsappWebhookController } from './whatsapp-webhook/whatsapp-webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email/email.service';
import { CalendarService } from './calendar/calendar.service';
import { EmailController } from './email/email.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [
    AppController,
    WhatsappController,
    WhatsappWebhookController,
    EmailController,
  ],
  providers: [
    AppService,
    WhatsappService,
    OpenaiService,
    EmailService,
    CalendarService,
  ],
})
export class AppModule {}
