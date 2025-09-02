// src/bulk-messaging/bulk-messaging.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BulkMessagingService {
  private readonly logger = new Logger(BulkMessagingService.name);

  constructor(
    private readonly dynamoService: DynamoService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async createSchedule(
    dto: CreateScheduleDto,
  ): Promise<{ scheduleId: string; [key: string]: any }> {
    const scheduleId = uuidv4();
    const schedule = {
      scheduleId,
      ...dto,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    return this.dynamoService.saveMessageSchedule(schedule) as Promise<{
      scheduleId: string;
      [key: string]: any;
    }>;
  }

  async getAllSchedules() {
    return this.dynamoService.getAllMessageSchedules();
  }

  async deleteSchedule(
    scheduleId: string,
  ): Promise<{ success: boolean; message?: string }> {
    return this.dynamoService.deleteMessageSchedule(scheduleId) as Promise<{
      success: boolean;
      message?: string;
    }>;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    this.logger.log('Verificando recordatorios de mensajes masivos...');

    const now = new Date();
    const schedules: Array<{
      scheduleId: string;
      name: string;
      phoneNumbers: string[];
      message: string;
      scheduleType: string;
      [key: string]: any;
    }> = await this.dynamoService.getDueSchedules(now);

    for (const schedule of schedules) {
      this.logger.log(`Enviando mensaje programado: ${schedule.name}`);
      for (const phoneNumber of schedule.phoneNumbers) {
        try {
          await this.whatsappService.sendMessage(phoneNumber, schedule.message);
        } catch (error) {
          this.logger.error(`Error al enviar mensaje a ${phoneNumber}`, error);
        }
      }

      if (schedule.scheduleType === 'once') {
        await this.dynamoService.deactivateSchedule(schedule.scheduleId);
      }
    }
  }
}
