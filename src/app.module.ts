import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook/whatsapp-webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email/email.service';
import { CalendarService } from './calendar/calendar.service';
import { EmailController } from './email/email.controller';
import { McpModule } from './mcp/mcp.module';
import { AgentService } from './langchain/agent/agent.service';
import { ChatModule } from './chat/chat.module';
import { PruebaService } from './prueba/prueba.service';
import { PruebaController } from './prueba/prueba/prueba.controller';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    McpModule,
    ChatModule,
    DatabaseModule,
  ],
  controllers: [
    AppController,
    WhatsappController,
    WhatsappWebhookController,
    EmailController,
    PruebaController,
  ],
  providers: [
    AppService,
    WhatsappService,
    EmailService,
    CalendarService,
    AgentService,
    PruebaService,
  ],
})
export class AppModule {}
