/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// src/bulk-messaging/bulk-messaging.service.ts
import {  Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

interface Contact {
  name: string;
  number: string;
}

interface TemplateSchedule {
  scheduleId: string;
  name: string;
  templateName: string;
  phoneNumbers: { name: string; number: string }[];
  scheduleType: 'once' | 'recurring';
  waba_id: string;
  number_id: string;
  [key: string]: any;
}

@Injectable()
export class BulkMessagingService {
  private readonly logger = new Logger(BulkMessagingService.name);

  constructor(
    private readonly dynamoService: DynamoService,
    private readonly whatsappService: WhatsappService,
  ) {
    this.logger.log(`¡BulkMessagingService inicializado! ID de instancia: `);
  }

  async createSchedule(
    dto: CreateScheduleDto,
  ): Promise<{ scheduleId: string; [key: string]: any }> {
    const scheduleId = uuidv4();
    let finalSendAt = dto.sendAt;
    if (dto.scheduleType === 'once' && dto.sendAt) {
      const localDateString = dto.sendAt.replace('Z', '');
      const localDate = new Date(localDateString);
      finalSendAt = localDate.toISOString();
    }
    const schedule = {
      scheduleId,
      ...dto,
      sendAt: finalSendAt,
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

  private buildTemplateComponents(
    template: any,
    contact: Contact,
    mediaId?: string,
  ): Array<{
    type: string;
    parameters: Array<{ type: string; [key: string]: any }>;
  }> {
    const components: Array<{
      type: string;
      parameters: Array<{ type: string; [key: string]: any }>;
    }> = [];

    if (mediaId) {
      const headerComponent = template.components.find(
        (c) => c.type === 'HEADER',
      );
      if (headerComponent) {
        components.push({
          type: 'header',
          parameters: [
            {
              type: headerComponent.format.toLowerCase(),
              [headerComponent.format.toLowerCase()]: {
                id: mediaId,
              },
            },
          ],
        });
      }
    }

    const bodyComponent = template.components.find((c) => c.type === 'BODY');
    if (
      bodyComponent &&
      bodyComponent.text &&
      bodyComponent.text.includes('{{1}}')
    ) {
      components.push({
        type: 'body',
        parameters: [{ type: 'text', text: contact.name }],
      });
    }

    // Este array puede expandirse en el futuro si se necesitan más variables (ej: para {{2}}, {{3}})
    return components;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const now = new Date();
    const schedules: TemplateSchedule[] =
      await this.dynamoService.getDueSchedules(now);

    if (!schedules || schedules.length === 0) return;

    for (const schedule of schedules) {
      try {
        this.logger.log(`Procesando programación: "${schedule.name}"`);

        const template = await this.whatsappService.getTemplateById(
          schedule.templateId,
          schedule.number_id,
        );
        let mediaId: string | undefined = undefined;

        // --- LÓGICA DE SUBIDA DE IMAGEN ---
        const headerComponent = template.components.find(
          (c) =>
            c.type === 'HEADER' &&
            (c.format === 'IMAGE' ||
              c.format === 'VIDEO' ||
              c.format === 'DOCUMENT'),
        );
        if (headerComponent && headerComponent.example?.header_handle?.[0]) {
          const temporaryUrl = headerComponent.example.header_handle[0];

          // 1. Descargar la imagen desde la URL temporal
          const response = await axios.get(temporaryUrl, {
            responseType: 'arraybuffer',
          });
          const imageBuffer = Buffer.from(response.data);
          const contentType = response.headers['content-type'];

          // 2. Subirla a WhatsApp y obtener el ID
          mediaId = await this.whatsappService.uploadMedia(
            schedule.number_id,
            imageBuffer,
            contentType,
          );
        }

        for (const contact of schedule.phoneNumbers) {
          const components = this.buildTemplateComponents(
            template,
            contact,
            mediaId,
          );

          await this.whatsappService.sendTemplateMessage(
            contact.number,
            schedule.number_id,
            template.name,
            template.language,
            components,
          );
        }

        if (schedule.scheduleType === 'once') {
          await this.dynamoService.deactivateSchedule(schedule.scheduleId);
        }
      } catch (error) {
        const errorMessage = typeof error === 'object' && error !== null && 'message' in error ? (error as any).message : String(error);
        const errorStack = typeof error === 'object' && error !== null && 'stack' in error ? (error as any).stack : undefined;
        this.logger.error(
          `Falló el procesamiento de la campaña "${schedule.name}". Causa: ${errorMessage}`,
          errorStack,
        );
        await this.dynamoService.deactivateSchedule(schedule.scheduleId); // Desactivar en caso de error
      }
    }
  }
}
