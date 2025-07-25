import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook/whatsapp-webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email/email.service';
import { CalendarService } from './calendar/calendar.service';
import { EmailController } from './email/email.controller';
import { PruebaService } from './prueba/prueba.service';
import { PruebaController } from './prueba/prueba/prueba.controller';
import { DatabaseModule } from './database/database.module';
import { ConversationLogModule } from './conversation-log/conversation-log.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    ConversationLogModule,
  ],
  controllers: [
    AppController,
    WhatsappWebhookController,
    EmailController,
    PruebaController,
  ],
  providers: [
    AppService,
    WhatsappService,
    EmailService,
    CalendarService,
    PruebaService,
  ],
})
export class AppModule {}
