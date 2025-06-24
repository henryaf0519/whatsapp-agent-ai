import { Module } from '@nestjs/common';
import { McpService } from './mcp/mcp.service';
import { McpController } from './mcp/mcp.controller';
import { EmailService } from 'src/email/email.service';
import { CalendarService } from 'src/calendar/calendar.service';

@Module({
  providers: [McpService, EmailService, CalendarService],
  controllers: [McpController],
  exports: [McpService],
})
export class McpModule {}
