/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// src/bulk-messaging/bulk-messaging.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { SocketGateway } from 'src/socket/socket.gateway';
import moment from 'moment-timezone';

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
  targetType: 'static_list' | 'dynamic_stage';
  targetStageId: string | null;
  [key: string]: any;
}

@Injectable()
export class BulkMessagingService {
  private readonly logger = new Logger(BulkMessagingService.name);

  constructor(
    private readonly dynamoService: DynamoService,
    private readonly whatsappService: WhatsappService,
    private readonly socketGateway: SocketGateway,
  ) {
    this.logger.log(`¡BulkMessagingService inicializado! ID de instancia: `);
  }

  async createSchedule(
    dto: CreateScheduleDto,
  ): Promise<{ scheduleId: string; [key: string]: any }> {
    const scheduleId = uuidv4();
    let finalSendAt = dto.sendAt;
    if (dto.scheduleType === 'once' && dto.sendAt) {
      const localDate = moment.tz(dto.sendAt, 'America/Bogota');
      finalSendAt = localDate.utc().toISOString();
      this.logger.log(
        `Programado en Colombia a las ${dto.sendAt}, se guardará en BD como UTC: ${finalSendAt}`,
      );
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

  /**
   * 1. Determina la lista de contactos a los que se enviará el mensaje (estática o dinámica).
   */
  private async getContactsForSchedule(
    schedule: TemplateSchedule,
  ): Promise<Contact[]> {
    if (schedule.targetType === 'dynamic_stage' && schedule.targetStageId) {
      const dynamicContacts = await this.dynamoService.getContactsByStage(
        schedule.number_id,
        schedule.targetStageId,
      );

      const contactsToSend = dynamicContacts
        .filter((c) => c.conversationId)
        .map((c) => ({
          name: c.contactName || c.name,
          number: c.conversationId,
        }));

      if (contactsToSend.length === 0) {
        this.logger.warn(
          `No se encontraron contactos para la etapa: ${schedule.targetStageId}.`,
        );
      } else {
        this.logger.log(
          `Encontrados ${contactsToSend.length} contactos dinámicos.`,
        );
      }
      return contactsToSend;
    } else if (
      schedule.targetType === 'static_list' &&
      schedule.phoneNumbers?.length > 0
    ) {
      return schedule.phoneNumbers;
    }

    this.logger.warn(
      `Configuración de target inválida para el schedule: ${schedule.scheduleId}.`,
    );
    return [];
  }

  /**
   * 2. Prepara la plantilla, subiendo el archivo multimedia de cabecera si es necesario.
   */
  private async prepareTemplateAndMedia(
    schedule: TemplateSchedule,
  ): Promise<{ template: any; mediaId?: string }> {
    const template = await this.whatsappService.getTemplateById(
      schedule.templateId,
      schedule.number_id,
    );
    let mediaId: string | undefined = undefined;

    const headerComponent = template.components.find(
      (c) =>
        c.type === 'HEADER' &&
        (c.format === 'IMAGE' ||
          c.format === 'VIDEO' ||
          c.format === 'DOCUMENT'),
    );

    if (headerComponent && headerComponent.example?.header_handle?.[0]) {
      const temporaryUrl = headerComponent.example.header_handle[0];
      const response = await axios.get(temporaryUrl, {
        responseType: 'arraybuffer',
      });
      const imageBuffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'];

      mediaId = await this.whatsappService.uploadMedia(
        schedule.number_id,
        imageBuffer,
        contentType,
      );
      this.logger.log(`Media subida a Meta con ID: ${mediaId}`);
    }

    return { template, mediaId };
  }

  /**
   * 3. Envía el mensaje de plantilla y registra el evento en DynamoDB y Socket.
   */
  private async sendAndLogTemplateMessage(
    schedule: TemplateSchedule,
    contact: Contact,
    template: any,
    mediaId?: string,
  ): Promise<void> {
    const components = this.buildTemplateComponents(template, contact, mediaId);

    const whatsAppResponse = await this.whatsappService.sendTemplateMessage(
      contact.number,
      schedule.number_id,
      template.name,
      template.language,
      components,
    );

    const messageId = whatsAppResponse.messages[0].id;
    const messageResp = template.name;

    // Guardar en DynamoDB (ConversationsTable)
    await this.dynamoService.saveMessage(
      schedule.number_id,
      contact.number,
      'IA',
      messageResp,
      messageId,
      'SEND',
      'plantilla',
    );

    // Notificar por Socket
    const socketMessage = {
      from: 'IA',
      text: messageResp,
      type: 'plantilla',
      SK: `MESSAGE#${new Date().toISOString()}`,
    };

    this.socketGateway.sendNewMessageNotification(
      schedule.number_id,
      contact.number,
      socketMessage,
    );
  }

  // =========================================================
  // CRON PRINCIPAL (REFACTORIZADO)
  // =========================================================

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const now = new Date();
    const schedules: TemplateSchedule[] =
      await this.dynamoService.getDueSchedules(now);

    if (!schedules || schedules.length === 0) return;

    for (const schedule of schedules) {
      try {
        this.logger.log(`Procesando programación: "${schedule.name}"`);

        // 1. Obtener lista de contactos (estática o dinámica)
        const contactsToSend = await this.getContactsForSchedule(schedule);

        if (contactsToSend.length === 0) {
          // Si no hay contactos (y es de una sola vez), desactivar y continuar
          if (schedule.scheduleType === 'once') {
            await this.dynamoService.deactivateSchedule(schedule.scheduleId);
          }
          continue;
        }

        // 2. Preparar plantilla y media
        const { template, mediaId } =
          await this.prepareTemplateAndMedia(schedule);

        // 3. Enviar a cada contacto y registrar
        for (const contact of contactsToSend) {
          await this.sendAndLogTemplateMessage(
            schedule,
            contact,
            template,
            mediaId,
          );
        }

        // 4. Desactivar si es de una sola vez
        if (schedule.scheduleType === 'once') {
          await this.dynamoService.deactivateSchedule(schedule.scheduleId);
        }

        this.logger.log(
          `Programación "${schedule.name}" completada exitosamente.`,
        );
      } catch (error) {
        const errorMessage =
          typeof error === 'object' && error !== null && 'message' in error
            ? (error as any).message
            : String(error);
        const errorStack =
          typeof error === 'object' && error !== null && 'stack' in error
            ? (error as any).stack
            : undefined;
        this.logger.error(
          `Falló el procesamiento de la campaña "${schedule.name}". Causa: ${errorMessage}`,
          errorStack,
        );
        // Desactivar siempre en caso de error para evitar que se repita la ejecución fallida
        await this.dynamoService.deactivateSchedule(schedule.scheduleId);
      }
    }
  }
}
