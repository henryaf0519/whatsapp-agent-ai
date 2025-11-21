/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// src/bulk-messaging/bulk-messaging/bulk-messaging.service.ts
import {  Injectable, Logger } from '@nestjs/common';
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
  templateId: string;
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
    this.logger.log(`¡BulkMessagingService inicializado!`);
  }

  async createSchedule(
    dto: CreateScheduleDto,
  ): Promise<{ scheduleId: string; [key: string]: any }> {
    const scheduleId = uuidv4();
    let finalSendAt = dto.sendAt;

    if (dto.scheduleType === 'recurring' && !finalSendAt) {
      const baseDate = moment(); 
      finalSendAt = baseDate.utc().startOf('minute').toISOString();
      this.logger.log(`[Schedule Recurrente] Fecha de activación ajustada a inicio de minuto: ${finalSendAt}`);
    }
    if (dto.scheduleType === 'once' && dto.sendAt) {
      const localDate = moment.tz(dto.sendAt, 'America/Bogota');
      finalSendAt = localDate.utc().toISOString();
      this.logger.log(`Programado en Colombia: ${dto.sendAt}, Guardado UTC: ${finalSendAt}`);
    }
    const schedule = {
      scheduleId,
      ...dto,
      sendAt: finalSendAt,
      createdAt: new Date().toISOString(),
      isActive: true,
      is_active_flag: 'ACTIVE',
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

  // =========================================================
  // HELPERS (Con Logs Detallados)
  // =========================================================

  private buildTemplateComponents(
    template: any,
    contact: Contact,
    mediaId?: string,
    triggers: any[] = [], 
  ): Array<{
    type: string;
    sub_type?: string;
    index?: number;
    parameters: Array<{ type: string; [key: string]: any }>;
  }> {
    const components: Array<any> = [];

    // 1. HEADER
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

    // 2. BODY
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

    // 3. BUTTONS (Payload Injection)
    if (triggers && triggers.length > 0) {
      this.logger.debug(`[Build] Inyectando payloads para ${triggers.length} botones...`);
      triggers.forEach((trigger) => {
        // Extraemos índice (Dynamo puede devolver N o S, aseguramos Number)
        const idxVal = trigger.initial_data?.button_index ?? trigger.initial_data?.index;
        const buttonIndex = idxVal !== undefined ? Number(idxVal) : undefined;

        if (buttonIndex !== undefined) {
          this.logger.debug(`[Build] Botón index ${buttonIndex} -> payload: "${trigger.name}"`);
          components.push({
            type: 'button',
            sub_type: 'quick_reply',
            index: buttonIndex,
            parameters: [
              {
                type: 'payload',
                payload: trigger.name,
              },
            ],
          });
        }
      });
    }

    return components;
  }

  private async getContactsForSchedule(schedule: TemplateSchedule): Promise<Contact[]> {
    this.logger.debug(`[Contacts] Resolviendo contactos. Tipo: ${schedule.targetType}`);
    
    if (schedule.targetType === 'dynamic_stage' && schedule.targetStageId) {
      this.logger.debug(`[Contacts] Buscando en BD por etapa: "${schedule.targetStageId}" (Business: ${schedule.number_id})`);
      const dynamicContacts = await this.dynamoService.getContactsByStage(
        schedule.number_id,
        schedule.targetStageId
      );
      
      const contactsToSend = dynamicContacts
        .filter(c => c.conversationId)
        .map(c => ({
          name: c.contactName || c.name || 'Cliente',
          number: c.conversationId
        }));
        
      this.logger.debug(`[Contacts] Contactos dinámicos encontrados: ${contactsToSend.length}`);
      return contactsToSend;

    } else if (schedule.targetType === 'static_list' && schedule.phoneNumbers?.length > 0) {
      this.logger.debug(`[Contacts] Usando lista estática (${schedule.phoneNumbers.length} números)`);
      return schedule.phoneNumbers;
    } 
    
    this.logger.warn(`[Contacts] Configuración inválida o vacía para schedule: ${schedule.scheduleId}`);
    return [];
  }

  private async prepareTemplateAndMedia(schedule: TemplateSchedule): Promise<{ template: any; mediaId?: string }> {
    this.logger.debug(`[Media] Obteniendo info de plantilla ID: ${schedule.templateId}`);
    const template = await this.whatsappService.getTemplateById(
      schedule.templateId,
      schedule.number_id,
    );
    let mediaId: string | undefined = undefined;

    const headerComponent = template.components.find(
      (c) =>
        c.type === 'HEADER' &&
        ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(c.format),
    );

    if (headerComponent && headerComponent.example?.header_handle?.[0]) {
      const temporaryUrl = headerComponent.example.header_handle[0];
      this.logger.debug(`[Media] Descargando media header...`);

      try {
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
        this.logger.debug(`[Media] Subido a Meta. ID: ${mediaId}`);
      } catch (e) {
        this.logger.error(`[Media] Error subiendo media header: ${e}`);
      }
    }

    return { template, mediaId };
  }

  private async sendAndLogTemplateMessage(
    schedule: TemplateSchedule,
    contact: Contact,
    template: any,
    mediaId?: string,
    triggers: any[] = [],
  ): Promise<void> {
    try {
      const components = this.buildTemplateComponents(
        template,
        contact,
        mediaId,
        triggers,
      );
      const whatsAppResponse = await this.whatsappService.sendTemplateMessage(
        contact.number,
        schedule.number_id,
        template.name,
        template.language,
        components,
      );
      
      const messageId = whatsAppResponse.messages[0].id;
      const messageResp = template.name;

      // Guardar en DynamoDB
      await this.dynamoService.saveMessage(
        schedule.number_id,
        contact.number,
        'IA',
        messageResp,
        messageId,
        'SEND',
        'plantilla',
      );
      
      // Socket
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
      this.logger.debug(`[Send] OK. MessageID: ${messageId}`);
    } catch (e) {
      this.logger.error(`[Send] Error enviando a ${contact.number}:`, e);
    }
  }

  // =========================================================
  // CRON PRINCIPAL (CON LOGS DETALLADOS)
  // =========================================================

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const now = new Date();
    const schedules: TemplateSchedule[] =
      await this.dynamoService.getDueSchedules(now);

    if (!schedules || schedules.length === 0) {
       return;
    }


    for (const schedule of schedules) {
      try {
        const contactsToSend = await this.getContactsForSchedule(schedule);

        if (contactsToSend.length === 0) {
          this.logger.warn(`[Cron] Schedule sin contactos válidos. Desactivando.`);
          if (schedule.scheduleType === 'once') {
             await this.dynamoService.deactivateSchedule(schedule.scheduleId);
          }
          continue; 
        }

        // 3. Preparar Template y Media
        const { template, mediaId } = await this.prepareTemplateAndMedia(schedule);

        const templateTriggers = await this.dynamoService.getTriggersByTemplateId(
          schedule.number_id, 
          schedule.templateId 
        );
        
        if (templateTriggers.length > 0) {
            this.logger.log(`[Cron] Se inyectarán ${templateTriggers.length} payloads de botones.`);
        } else {
            this.logger.debug(`[Cron] No se encontraron triggers para botones de esta plantilla.`);
        }

        // 5. Enviar Mensajes
        let sentCount = 0;
        for (const contact of contactsToSend) { 
          await this.sendAndLogTemplateMessage(
            schedule,
            contact,
            template,
            mediaId,
            templateTriggers, // Pasamos los triggers encontrados
          );
          sentCount++;
        }
        this.logger.log(`[Cron] Enviados ${sentCount} mensajes.`);

        // 6. Desactivar si es 'once'
        if (schedule.scheduleType === 'once') {
          this.logger.log(`[Cron] Desactivando schedule 'once'.`);
          await this.dynamoService.deactivateSchedule(schedule.scheduleId);
        }
        
        this.logger.log(`[Cron] <<< Schedule "${schedule.name}" completado.`);

      } catch (error) {
        const errorMessage = typeof error === 'object' && error !== null && 'message' in error ? (error as any).message : String(error);
        this.logger.error(
          `[Cron] CRITICAL ERROR procesando schedule "${schedule.name}": ${errorMessage}`,
          error,
        );
        // Desactivamos para que no se quede en bucle infinito de error
        await this.dynamoService.deactivateSchedule(schedule.scheduleId);
      }
    }
  }
}