/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ConfigService } from '@nestjs/config';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import moment from 'moment-timezone';
import { v4 as uuidv4 } from 'uuid';
import { normalizeString } from '../../utils/utils';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import cronParser from 'cron-parser';

interface AgentScheduleItem {
  id: string;
  timestamp: string;
  [key: string]: any;
}

interface ConversationItem {
  userId: string;
  userHistory: string;
  actions?: {
    services?: string;
    activityEconomic?: string;
  };
  timestamp: string;
}

@Injectable()
export class DynamoService {
  private readonly dynamoClient: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly logger = new Logger(DynamoService.name);
  constructor(
    private config: ConfigService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {
    this.dynamoClient = new DynamoDBClient({
      region: this.config.get<string>('AWS_REGION'),
    });
    this.docClient = DynamoDBDocumentClient.from(this.dynamoClient);
  }

  async guardarDato(payload: Record<string, any>): Promise<AgentScheduleItem> {
    const item: AgentScheduleItem = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...payload,
    };
    await this.docClient.send(
      new PutCommand({ TableName: 'AgentSchedule', Item: item }),
    );
    return item;
  }

  async obtenerPsicologoPorNombre(nombre) {
    const params = {
      TableName: 'Psychologists',
      FilterExpression: 'contains(nombre, :nombre)',
      ExpressionAttributeValues: { ':nombre': nombre },
    };
    try {
      const { Items } = await this.docClient.send(new ScanCommand(params));
      if (Items && Items.length) return Items[0];
      throw new Error('Psicólogo no encontrado');
    } catch (error) {
      this.logger.error(
        'Error consultando psicólogo:',
        error,
        'obtenerPsicologoPorNombre',
      );
    }
  }

  generarSlots(
    startHour: number,
    endHour: number,
    slotDuration: number,
    breakStart: number,
    breakEnd: number,
    fecha: string,
  ): string[] {
    const slots: string[] = [];

    let current = moment
      .tz(fecha, 'America/Bogota')
      .startOf('day')
      .add(startHour, 'hours');

    const end = moment(current)
      .clone()
      .add(endHour - startHour, 'hours');

    while (current.isBefore(end)) {
      const hour = current.hour();

      if (hour < breakStart || hour >= breakEnd) {
        const formattedDate = current.format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z';
        slots.push(formattedDate);
      }

      current = current.add(slotDuration, 'minutes');
    }
    return slots;
  }

  async obtenerHorarios(psychologistId) {
    const params = {
      TableName: 'WorkingHours',
      IndexName: 'psychologistId-index',
      KeyConditionExpression: 'psychologistId = :pid',
      ExpressionAttributeValues: { ':pid': psychologistId },
    };
    try {
      const { Items } = await this.docClient.send(new QueryCommand(params));
      if (Items && Items.length > 0) {
        return Items[0];
      } else {
        throw new Error('Horarios no encontrados para este psicólogo.');
      }
    } catch (error) {
      this.logger.error('Error obteniendo horarios:', error, 'obtenerHorarios');
    }
  }

  async obtenerCitasOcupadas(psychologistId, fecha) {
    const dayStart = moment
      .tz(fecha, 'America/Bogota')
      .startOf('day')
      .toISOString();
    const dayEnd = moment
      .tz(fecha, 'America/Bogota')
      .endOf('day')
      .toISOString();
    const params = {
      TableName: 'AgentSchedule',
      IndexName: 'psychologistId-index',
      KeyConditionExpression:
        'psychologistId = :pid AND appointmentDateTime BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pid': psychologistId,
        ':start': dayStart,
        ':end': dayEnd,
      },
    };
    try {
      const { Items } = await this.docClient.send(new QueryCommand(params));
      return new Set(Items?.map((c) => c.appointmentDateTime));
    } catch (error) {
      this.logger.error(
        'Error obteniendo citas:',
        error,
        'obtenerCitasOcupadas',
      );
      return new Set();
    }
  }

  async obtenerHuecosDisponibles(name: string, fecha) {
    const psicologo = await this.obtenerPsicologoPorNombre(
      normalizeString(name),
    );
    if (!psicologo || psicologo instanceof Error) {
      throw new Error('Psicólogo no encontrado');
    }
    const horario = await this.obtenerHorarios(psicologo.psychologistId);
    if (!horario) return [];
    const slots = this.generarSlots(
      horario.startHour,
      horario.endHour,
      horario.slotDuration,
      horario.breakStart,
      horario.breakEnd,
      fecha,
    );
    const ocupadas = await this.obtenerCitasOcupadas(psicologo.id, fecha);
    return slots
      .filter((slot) => !ocupadas.has(slot))
      .map((slot) => {
        const date = new Date(slot);
        const startTime = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
        const endDate = new Date(date).setUTCHours(date.getUTCHours() + 1);
        const endTime = `${String(new Date(endDate).getUTCHours()).padStart(2, '0')}:${String(new Date(endDate).getUTCMinutes()).padStart(2, '0')}`;
        return `${startTime} - ${endTime}`;
      })
      .join(', ');
  }

  async huecoDisponible(date, hour, psychologistId) {
    if (hour.length === 4) hour = `0${hour}`;

    const local = moment.tz(
      `${date}T${hour}:00`,
      'YYYY-MM-DDTHH:mm:ss',
      'America/Bogota',
    );
    const formattedDate = local.format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z';
    const appointmentDateTime = formattedDate;
    const params = {
      TableName: 'AgentSchedule',
      IndexName: 'psychologistId-index',
      KeyConditionExpression:
        'psychologistId = :pid AND appointmentDateTime = :adt',
      ExpressionAttributeValues: {
        ':pid': psychologistId,
        ':adt': appointmentDateTime,
      },
    };
    try {
      const { Items } = await this.docClient.send(new QueryCommand(params));
      if (Items && Items.length > 0) {
        return false;
      } else {
        return true;
      }
    } catch (error) {
      this.logger.error('Error al validar el hueco:', error, 'huecoDisponible');
      return false;
    }
  }

  async createAppointment(date, hour, psychologistId, email) {
    if (hour.length === 4) hour = `0${hour}`;
    const local = moment.tz(
      `${date}T${hour}:00`,
      'YYYY-MM-DDTHH:mm:ss',
      'America/Bogota',
    );
    const appointmentDateTime = local.format('YYYY-MM-DDTHH:mm:ss.SSS') + 'Z';
    if (!moment(appointmentDateTime).isValid())
      throw new Error('Fecha y hora combinadas no son válidas');
    const item = {
      appointmentDateTime,
      psychologistId,
      patientEmail: email,
      status: 'CONFIRMED',
      id: uuidv4(),
    };
    try {
      await this.docClient.send(
        new PutCommand({ TableName: 'AgentSchedule', Item: item }),
      );
      return { success: true, message: 'Cita creada con éxito', item };
    } catch (error) {
      this.logger.error('Error al crear la cita:', error, 'createAppointment');
      return { success: false, message: 'Error al crear la cita' };
    }
  }

  async createUser(
    name,
    doc,
    ips,
    date,
    eps,
    pension,
    box,
    risk,
    phone,
    address,
    service,
  ) {
    const item = {
      id: uuidv4(),
      name,
      doc,
      ips,
      date,
      eps,
      pension,
      box,
      risk,
      phone,
      address,
      createdAt: new Date().toISOString(),
      service,
    };
    try {
      await this.docClient.send(
        new PutCommand({ TableName: 'users_afiliamos', Item: item }),
      );
      return { success: true, message: 'usuario creado con exito', item };
    } catch (error) {
      this.logger.error('Error al crear registro:', error, 'createUser');
      return { success: false, message: 'Error al crear registro' };
    }
  }

  async crearCita(date, hour, name, email) {
    const psicologo = await this.obtenerPsicologoPorNombre(
      normalizeString(name),
    );
    if (!psicologo || psicologo instanceof Error) {
      throw new Error('Psicólogo no encontrado');
    }
    if (!(await this.huecoDisponible(date, hour, psicologo.psychologistId)))
      return {
        success: false,
        message: 'El hueco seleccionado ya está ocupado.',
      };
    const resp = await this.createAppointment(
      date,
      hour,
      psicologo.psychologistId,
      email,
    );
    if (!resp.success) {
      return {
        success: false,
        message: resp.message || 'Error al crear la cita',
      };
    }
    return {
      success: true,
      message: 'Cita creada con éxito',
      psicologo: psicologo.email,
    };
  }

  async crearUsuario(
    name,
    doc,
    ips,
    date,
    eps,
    pension,
    box,
    risk,
    phone,
    address,
    service,
  ) {
    const resp = await this.createUser(
      name,
      doc,
      ips,
      date,
      eps,
      pension,
      box,
      risk,
      phone,
      address,
      service,
    );
    if (!resp.success) {
      return {
        success: false,
        message: resp.message || 'Error al crear la cita',
      };
    }
    return {
      success: true,
      message: 'Cita creada con éxito',
    };
  }

  async getConversationHistory(
    userId: string,
  ): Promise<ConversationItem | undefined> {
    const command = new GetCommand({
      TableName: 'ConversationHistory',
      Key: {
        userId: userId,
      },
    });

    try {
      const result = await this.docClient.send(command);
      return result.Item as ConversationItem;
    } catch (error) {
      this.logger.error(
        'Error getting conversation history from DynamoDB',
        error,
        'getConversationHistory',
      );
      return undefined;
    }
  }

  async saveConversationHistory(
    userId: string,
    history: string,
    actions?: { services?: string; activityEconomic?: string },
  ): Promise<void> {
    const command = new PutCommand({
      TableName: 'ConversationHistory',
      Item: {
        userId: userId,
        userHistory: history,
        actions: actions || {},
        timestamp: new Date().toISOString(),
      },
    });

    try {
      await this.docClient.send(command);
    } catch (error) {
      this.logger.error(
        'Error saving conversation history to DynamoDB',
        error,
        'saveConversationHistory',
      );
    }
  }

  async findUser(doc) {
    const command = new GetCommand({
      TableName: 'users_monthly',
      Key: {
        id: doc,
      },
    });

    try {
      const result = await this.docClient.send(command);
      this.logger.log(`User found: ${JSON.stringify(result)}`, 'findUser');
      return result.Item;
    } catch (error) {
      this.logger.error(
        'Error getting conversation history from DynamoDB',
        error,
        'findUser',
      );
      return undefined;
    }
  }

  async findPrices(id: string, economicactivity?: number) {
    const command = new QueryCommand({
      TableName: 'prices', // Replace with your actual table name
      IndexName: 'id-economicActivity-index', // The name of your GSI
      KeyConditionExpression: '#id = :id AND #ea = :ea',
      ExpressionAttributeNames: {
        '#id': 'id',
        '#ea': 'economicActivity',
      },
      ExpressionAttributeValues: {
        ':id': id,
        ':ea': economicactivity, // The economic activity number you want to query
      },
    });

    try {
      const response = await this.docClient.send(command);

      if (response.Items && response.Items.length > 0) {
        return response.Items[0].value;
      }
      return '';
    } catch (error) {
      this.logger.error('Error querying DynamoDB GSI:', error, 'findPrices');
    }
  }

  async findPolicies(id: string) {
    const command = new QueryCommand({
      TableName: 'prices', // Replace with your actual table name
      KeyConditionExpression: '#id = :id',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ExpressionAttributeValues: {
        ':id': id, // The economic activity number you want to query
      },
    });

    try {
      const response = await this.docClient.send(command);

      if (response.Items && response.Items.length > 0) {
        return response.Items[0].value;
      }
      return '';
    } catch (error) {
      this.logger.error('Error querying DynamoDB GSI:', error, 'findPolicies');
    }
  }

  async saveMessage(
    businessId: string,
    conversationId: string,
    from: string,
    text: string,
    messageId: string,
    status: string,
    type: string,
    url?: string,
  ): Promise<any> {
    const timestamp = new Date().toISOString();
    const item: any = {
      PK: `CONVERSATION#${businessId}#${conversationId}`,
      SK: `MESSAGE#${timestamp}`,
      from: from,
      type: type,
      text: text,
      id_mensaje_wa: messageId,
      estado: status,
    };

    if (url) {
      item.url = url;
    }

    const command = new PutCommand({
      TableName: 'ConversationsTable',
      Item: item,
    });

    try {
      const response = await this.docClient.send(command);
      return response;
    } catch (error) {
      console.error('Error al guardar el mensaje:', error);
      throw error;
    }
  }

  async handleAgentMessage(
    businessId: string,
    conversationId: string,
    text: string,
  ): Promise<any> {
    // Generamos la clave de ordenación (SK) con un timestamp para el orden cronológico
    const timestamp = new Date().toISOString();

    const command = new PutCommand({
      TableName: 'ConversationsTable',
      Item: {
        PK: `CONVERSATION#${businessId}#${conversationId}`,
        SK: `MESSAGE#${timestamp}`,
        from: 'IA',
        type: 'text',
        text: text,
        id_mensaje_wa: '',
        estado: 'SEND',
      },
    });

    try {
      const response = await this.docClient.send(command);
      await this.whatsappService.sendMessage(conversationId, businessId, text);
      return response;
    } catch (error) {
      console.error('Error al guardar el mensaje:', error);
      throw error;
    }
  }

  async getMessages(
    businessId: string,
    conversationId: string,
  ): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'ConversationsTable',
      KeyConditionExpression: '#pk = :pkValue',
      ExpressionAttributeNames: {
        '#pk': 'PK',
      },
      ExpressionAttributeValues: {
        ':pkValue': `CONVERSATION#${businessId}#${conversationId}`,
      },
      ScanIndexForward: true,
    });

    try {
      const response = await this.docClient.send(command);
      // Retorna los ítems (mensajes) de la conversación, o un array vacío si no hay.
      return response.Items ?? [];
    } catch (error) {
      console.error('Error al obtener la conversación:', error);
      throw error;
    }
  }

  async getChat(conversationId: string): Promise<any> {
    const command = new QueryCommand({
      TableName: 'ConversationsTable',
      KeyConditionExpression: '#pk = :pkValue AND #sk = :skValue',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pkValue': `CONVERSATION#${conversationId}`,
        ':skValue': `CONVERSATION#${conversationId}`,
      },
    });

    try {
      const response = await this.docClient.send(command);
      return response.Items?.[0] ?? null;
    } catch (error) {
      console.error('Error al obtener los metadatos del chat:', error);
      throw error;
    }
  }

  // En tu clase DynamoDBService
  async getConversations(): Promise<string[]> {
    const command = new ScanCommand({
      TableName: 'ConversationsTable',
      ProjectionExpression: 'PK',
    });

    try {
      const response = await this.docClient.send(command);
      if (!response.Items || response.Items.length === 0) {
        return [];
      }

      const uniqueConversations = new Set<string>();

      response.Items.forEach((item) => {
        // El PK es un objeto, y el valor de la cadena está en item.PK.S
        if (item.PK) {
          const conversationId = item.PK.replace('CONVERSATION#', '');
          uniqueConversations.add(conversationId);
        }
      });

      return Array.from(uniqueConversations);
    } catch (error) {
      console.error('Error al obtener la lista de conversaciones:', error);
      throw error;
    }
  }

  async getChatMode(
    businessId: string,
    conversationId: string,
  ): Promise<'IA' | 'humano'> {
    const command = new GetCommand({
      TableName: 'ChatControl',
      Key: { businessId, conversationId },
    });

    try {
      const response = await this.docClient.send(command);
      return response.Item?.modo || 'IA';
    } catch (error) {
      console.error('Error al obtener el modo de chat:', error);
      throw error;
    }
  }

  async updateChatMode(
    businessId: string,
    conversationId: string,
    newMode: 'IA' | 'humano',
  ): Promise<{ success: boolean; message: string }> {
    const command = new UpdateCommand({
      TableName: 'ChatControl',
      Key: { businessId, conversationId },
      UpdateExpression: 'SET modo = :newMode',
      ExpressionAttributeValues: {
        ':newMode': newMode,
      },
    });

    try {
      await this.docClient.send(command);
      return { success: true, message: 'Modo actualizado correctamente.' };
    } catch (error) {
      console.error('Error al actualizar el modo del chat:', error);
      throw error;
    }
  }

  async createOrUpdateChatMode(
    businessId: string,
    contactName: string,
    conversationId: string,
    modo: 'IA' | 'humano' = 'IA',
  ): Promise<void> {
    const command = new PutCommand({
      TableName: 'ChatControl',
      Item: {
        businessId,
        conversationId,
        contactName,
        modo,
        name: contactName,
        stage: 'Nuevo',
        createdAt: new Date().toISOString(),
      },
      ConditionExpression:
        'attribute_not_exists(businessId) AND attribute_not_exists(conversationId)',
    });

    try {
      await this.docClient.send(command);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        console.log(
          `Registro para ${conversationId} ya existe. No se sobrescribió.`,
        );
      } else {
        console.error('Error al crear/actualizar el modo del chat:', error);
        throw error;
      }
    }
  }

  async updateContactStage(
    businessId: string,
    conversationId: string,
    stage: string,
  ): Promise<any> {
    const command = new UpdateCommand({
      TableName: 'ChatControl',
      Key: { businessId, conversationId },
      UpdateExpression: 'set #stage = :stage',
      ExpressionAttributeNames: {
        '#stage': 'stage',
      },
      ExpressionAttributeValues: {
        ':stage': stage,
      },
      ReturnValues: 'ALL_NEW',
    });

    try {
      const response = await this.docClient.send(command);
      this.logger.log(
        `Etapa del contacto ${conversationId} actualizada a "${stage}"`,
      );
      return response.Attributes;
    } catch (error) {
      this.logger.error(
        `Error al actualizar la etapa del contacto ${conversationId}`,
        error,
      );
      throw error;
    }
  }

  async getContactsForBusiness(businessId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'ChatControl',
      KeyConditionExpression: 'businessId = :businessId',
      ExpressionAttributeValues: {
        ':businessId': businessId,
      },
    });

    try {
      const { Items } = await this.docClient.send(command);
      return Items || [];
    } catch (error) {
      this.logger.error(`Error obteniendo contactos para ${businessId}`, error);
      return [];
    }
  }

  async findUserByEmail(email: string): Promise<any | undefined> {
    const command = new GetCommand({
      TableName: 'login',
      Key: {
        email: email,
      },
    });

    try {
      const result = await this.docClient.send(command);
      return result.Item;
    } catch (error) {
      this.logger.error(
        'Error al encontrar el usuario por email:',
        error,
        'findUserByEmail',
      );
      return undefined;
    }
  }

  async createUserLogin(
    email: string,
    passwordHashed: string,
    waba_id: string,
    whatsapp_token: string,
    number_id: string,
    app_id: string,
  ): Promise<any> {
    const command = new PutCommand({
      TableName: 'login',
      Item: {
        email: email,
        password: passwordHashed,
        number_id: number_id,
        waba_id: waba_id,
        whatsapp_token: whatsapp_token,
        app_id: app_id,
      },
    });

    try {
      await this.docClient.send(command);
      this.logger.log(`Usuario ${email} creado en la tabla 'login'.`);
      return { email };
    } catch (error) {
      this.logger.error(
        'Error al crear usuario en la tabla login:',
        error,
        'createUser',
      );
      throw new Error('No se pudo crear el usuario en la base de datos.');
    }
  }

  /**
   * Guarda o actualiza un lote de plantillas para una cuenta de WhatsApp específica.
   * @param wabaId - El ID de la cuenta de WhatsApp Business.
   * @param templates - El array de objetos de plantilla obtenidos de la API de Meta.
   */
  async saveTemplatesForAccount(
    wabaId: string,
    templates: any[],
  ): Promise<void> {
    if (!templates || templates.length === 0) {
      return;
    }

    const validTemplates = templates.filter(
      (template) =>
        template.status === 'APPROVED' &&
        template.components &&
        template.components.some((c) => c.type === 'BODY'),
    );

    if (validTemplates.length === 0) {
      this.logger.log('No hay plantillas válidas para guardar.');
      return;
    }

    const putRequests = validTemplates.map((template) => {
      const bodyComponent = template.components.find((c) => c.type === 'BODY');
      const buttonsComponent = template.components.find(
        (c) => c.type === 'BUTTONS',
      );

      return {
        PutRequest: {
          Item: {
            waba_id: wabaId,
            name: template.name,
            language: template.language,
            category: template.category,
            body: bodyComponent.text || '',
            buttons: buttonsComponent
              ? buttonsComponent.buttons.map((btn) => ({
                  id: btn.text.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                  title: btn.text,
                }))
              : [],
          },
        },
      };
    });

    for (let i = 0; i < putRequests.length; i += 25) {
      const batch = putRequests.slice(i, i + 25);
      const command = new BatchWriteCommand({
        RequestItems: {
          whatsappTemplates: batch,
        },
      });

      try {
        await this.docClient.send(command);
        this.logger.log(
          `Lote de ${batch.length} plantillas guardado para ${wabaId}`,
        );
      } catch (error) {
        this.logger.error(
          `Error guardando lote de plantillas para ${wabaId}`,
          error,
        );
      }
    }
  }

  /**
   * Obtiene todas las plantillas asociadas a una cuenta de WhatsApp.
   * @param wabaId - El ID de la cuenta de WhatsApp Business.
   * @returns Un array con las plantillas encontradas.
   */
  async getTemplatesForAccount(wabaId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'whatsappTemplates',
      KeyConditionExpression: 'waba_id = :wabaId',
      ExpressionAttributeValues: {
        ':wabaId': wabaId,
      },
    });

    try {
      const response = await this.docClient.send(command);
      this.logger.log(
        `Se encontraron ${response.Items?.length || 0} plantillas para ${wabaId}`,
      );
      return response.Items || [];
    } catch (error) {
      this.logger.error(`Error al obtener plantillas para ${wabaId}`, error);
      return []; // Devolvemos un array vacío en caso de error
    }
  }

  async saveMessageSchedule(schedule: any): Promise<any> {
    const command = new PutCommand({
      TableName: 'MessageSchedules',
      Item: schedule,
    });
    await this.docClient.send(command);
    return schedule;
  }

  async getAllMessageSchedules(): Promise<any[]> {
    const command = new ScanCommand({
      TableName: 'MessageSchedules',
    });
    const response = await this.docClient.send(command);
    return response.Items || [];
  }

  async deleteMessageSchedule(scheduleId: string): Promise<any> {
    const command = new DeleteCommand({
      TableName: 'MessageSchedules',
      Key: { scheduleId },
    });
    return this.docClient.send(command);
  }

  //

  async getDueSchedules(now: Date): Promise<any[]> {
    const NOW_UTC_STRING = moment.utc(now).toISOString();
    const FIXED_ACTIVE_FLAG = 'ACTIVE';
    const GSI_NAME = 'ActiveScheduleIndex';

    const command = new QueryCommand({
      TableName: 'MessageSchedules',
      IndexName: GSI_NAME,
      KeyConditionExpression: 'is_active_flag = :activeFlag AND sendAt <= :now',
      ExpressionAttributeValues: {
        ':activeFlag': FIXED_ACTIVE_FLAG,
        ':now': NOW_UTC_STRING,
      },
      ScanIndexForward: true, // Ordenar del más antiguo al más nuevo
    });

    const { Items } = await this.docClient.send(command);

    const dueSchedules = Items || [];
    const finalSchedules = dueSchedules.filter((schedule) => {
      if (schedule.scheduleType === 'once') {
        return true;
      }

      if (schedule.scheduleType === 'recurring' && schedule.cronExpression) {
        // Lógica de cron-parser (se mantiene igual)
        try {
          const interval = cronParser.parseExpression(schedule.cronExpression, {
            currentDate: new Date(now.getTime() - 60000),
            tz: 'America/Bogota',
          });
          const next = interval.next().toDate();

          const isMatch =
            next.getFullYear() === now.getFullYear() &&
            next.getMonth() === now.getMonth() &&
            next.getDate() === now.getDate() &&
            next.getHours() === now.getHours() &&
            next.getMinutes() === now.getMinutes();
          return isMatch;
        } catch (err) {
          this.logger.error(
            `[Dynamo GSI] Expresión CRON inválida para scheduleId ${schedule.scheduleId}`,
            err,
          );
          return false;
        }
      }
      return false;
    });
    return finalSchedules;
  }

  async deactivateSchedule(scheduleId: string): Promise<any> {
    const command = new UpdateCommand({
      TableName: 'MessageSchedules',
      Key: { scheduleId },
      // FIX: Establecemos isActive = false Y removemos el is_active_flag
      UpdateExpression: 'SET isActive = :false REMOVE is_active_flag',
      ExpressionAttributeValues: {
        ':false': false,
      },
    });
    try {
      this.logger.log(
        `[Dynamo] Desactivando Schedule ${scheduleId}. Removiendo GSI flag.`,
      );
      return this.docClient.send(command);
    } catch (error) {
      this.logger.error(`Error al desactivar schedule ${scheduleId}`, error);
      throw error;
    }
  }

  async findBusinessByNumberId(numberId: string): Promise<any | undefined> {
    const command = new QueryCommand({
      TableName: 'login',
      IndexName: 'number_id-index',
      KeyConditionExpression: 'number_id = :numberId',
      ExpressionAttributeValues: {
        ':numberId': numberId,
      },
    });

    try {
      const result = await this.docClient.send(command);
      if (result.Items && result.Items.length > 0) {
        return result.Items[0];
      }
      this.logger.warn(
        `No se encontraron credenciales para number_id: ${numberId}`,
      );
      return undefined;
    } catch (error) {
      this.logger.error(
        `Error al buscar credenciales por number_id: ${numberId}`,
        error,
      );
      return undefined;
    }
  }

  async createInteractiveButton(
    businessId: string,
    buttonData: any,
  ): Promise<any> {
    const item = {
      number_id: businessId,
      SK: `INTERACTIVE_BUTTON#${buttonData.name}`,
      ...buttonData,
      createdAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: 'InteractiveButtons',
      Item: item,
      ConditionExpression: 'attribute_not_exists(SK)',
    });

    try {
      await this.docClient.send(command);
      this.logger.log(
        `Botón interactivo creado: ${item.SK} para la cuenta ${item.number_id}`,
      );
      return item;
    } catch (error) {
      this.logger.error(`Error al crear boton`, error);
      return undefined;
    }
  }

  async getInteractiveButtonsForAccount(numberId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'InteractiveButtons',
      KeyConditionExpression: 'number_id = :numberId',
      FilterExpression: 'begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':numberId': numberId,
        ':skPrefix': 'INTERACTIVE_BUTTON#',
      },
    });

    const response = await this.docClient.send(command);
    this.logger.log(
      `Se encontraron ${response.Items?.length || 0} botones para la cuenta ${numberId}`,
    );
    return response.Items || [];
  }

  async saveClientFlowDefinition(
    numberId: string,
    flowId: string,
    flowJson: string,
    navigation: string,
    description: string = 'Definición de flujo',
  ): Promise<any> {
    const item = {
      number_id: numberId,
      flow_id: flowId,
      flow_definition: flowJson,
      navigation: navigation,
      description: description,
      updatedAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: 'ClientFlows',
      Item: item,
    });

    try {
      this.logger.log(`Guardando definición de flujo: ${numberId}/${flowId}`);
      await this.docClient.send(command);
      return { success: true, item };
    } catch (error) {
      this.logger.error(
        `Error al guardar la definición del flujo ${numberId}/${flowId}`,
        error,
      );
      throw new Error('Error al guardar la definición del flujo en DynamoDB');
    }
  }

  async getClientFlowDefinition(
    numberId: string,
    flowId: string,
  ): Promise<any> {
    const command = new GetCommand({
      TableName: 'ClientFlows',
      Key: {
        number_id: numberId,
        flow_id: flowId,
      },
    });

    try {
      const result = await this.docClient.send(command);

      if (!result.Item) {
        this.logger.error(
          `No se encontró definición de flujo para ${numberId}/${flowId}`,
        );
        throw new Error('Definición de flujo no encontrada');
      }
      return result.Item; // Devuelve el ítem completo (incluye 'flow_definition')
    } catch (error) {
      this.logger.error(
        `Error al obtener la definición del flujo ${numberId}/${flowId}`,
        error,
      );
      throw new Error('Error al obtener la definición del flujo de DynamoDB');
    }
  }

  async createFlowTrigger(
    numberId: string,
    triggerData: Record<string, any>,
  ): Promise<any> {
    const triggerId = uuidv4();
    const item = {
      number_id: numberId,
      trigger_id: triggerId,
      ...triggerData,
    };

    const command = new PutCommand({
      TableName: 'FlowTriggers', // La nueva tabla que crearás
      Item: item,
    });

    try {
      await this.docClient.send(command);
      this.logger.log(
        `Disparador de Flow creado: ${triggerId} para ${numberId}`,
      );
      return item;
    } catch (error) {
      this.logger.error('Error al crear el disparador de Flow', error);
      throw new Error('Error al crear el disparador de Flow');
    }
  }

  /**
   * Obtiene todos los disparadores de Flow para un negocio.
   */
  async getFlowTriggersForBusiness(numberId: string): Promise<any[] | null> {
    const command = new QueryCommand({
      TableName: 'FlowTriggers',
      KeyConditionExpression: 'number_id = :numberId',
      ExpressionAttributeValues: {
        ':numberId': numberId,
      },
    });

    try {
      const response = await this.docClient.send(command);
      if (!response.Items || (response.Items as any[]).length === 0) {
        return null;
      }
      return response.Items as any[];
    } catch (error) {
      this.logger.error(
        `Error obteniendo disparadores para ${numberId}`,
        error,
      );
      return [];
    }
  }

  /**
   * Actualiza un disparador de Flow existente.
   */
  async updateFlowTrigger(
    numberId: string,
    triggerId: string,
    updateData: Record<string, any>,
  ): Promise<any> {
    // Construir la expresión de actualización dinámicamente
    const updateExpression: string[] = ['set updatedAt = :updatedAt'];
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
    };
    const expressionAttributeNames: Record<string, string> = {};

    // Iteramos sobre el body, excluyendo las claves primarias
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) {
        const attrKey = `#${key}`;
        const attrValue = `:${key}`;
        updateExpression.push(`${attrKey} = ${attrValue}`);
        expressionAttributeNames[attrKey] = key;
        expressionAttributeValues[attrValue] = value;
      }
    }

    // Si no hay nada que actualizar (aparte de updatedAt), evitamos un error
    if (Object.keys(expressionAttributeNames).length === 0) {
      // Solo actualizamos 'updatedAt'
      const command = new UpdateCommand({
        TableName: 'FlowTriggers',
        Key: { number_id: numberId, trigger_id: triggerId },
        UpdateExpression: 'set updatedAt = :updatedAt',
        ExpressionAttributeValues: { ':updatedAt': new Date().toISOString() },
        ReturnValues: 'ALL_NEW',
      });
      const response = await this.docClient.send(command);
      return response.Attributes;
    }

    const command = new UpdateCommand({
      TableName: 'FlowTriggers',
      Key: {
        number_id: numberId,
        trigger_id: triggerId,
      },
      UpdateExpression: updateExpression.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    });

    try {
      const response = await this.docClient.send(command);
      this.logger.log(`Disparador de Flow actualizado: ${triggerId}`);
      return response.Attributes;
    } catch (error) {
      this.logger.error(
        `Error al actualizar el disparador de Flow: ${triggerId}`,
        error,
      );
      throw new Error('Error al actualizar el disparador');
    }
  }

  /**
   * Actualiza el registro de un usuario en la tabla 'login' para
   * almacenar su Google Refresh Token y marcar la autenticación como completada.
   * @param email El PK del usuario (email).
   * @param refreshToken El token a guardar.
   */
  async updateUserGoogleRefreshToken(
    email: string,
    refreshToken: string,
  ): Promise<any> {
    const command = new UpdateCommand({
      TableName: 'login',
      Key: {
        email: email,
      },
      UpdateExpression:
        'SET google_refresh_token = :token, hasGoogleAuth = :bool, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':token': refreshToken,
        ':bool': true,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'UPDATED_NEW',
    });

    try {
      this.logger.log(
        `Actualizando Google Refresh Token para el usuario: ${email}`,
      );
      const response = await this.docClient.send(command);
      this.logger.log(
        `Token guardado exitosamente para: ${email}`,
        response.Attributes,
      );
      return response.Attributes;
    } catch (error) {
      this.logger.error(
        `Error al guardar el refresh token para ${email}`,
        error,
      );
      throw new Error(
        'Error al actualizar el token del usuario en la base de datos.',
      );
    }
  }

  /**
   * Guarda un registro de una cita agendada en DynamoDB.
   * PK: APPT#[numberId]
   * SK: SLOT#[YYYY-MM-DD HH:mm]
   */
  // En src/database/dynamo/dynamo.service.ts

  /**
   * Guarda un registro de una cita agendada en DynamoDB.
   * Ahora incluye Nombre del Usuario y Link de Reunión.
   */
  async saveAppointment(
    numberId: string,
    slotId: string,
    userNumber: string,
    title: string,
    duration: number,
    guestEmail: string | null,
    googleEventId: string,
    professionalId: string = 'any_professional',
    userName: string = '',
    meetingLink: string = '',
  ): Promise<any> {
    const skComposite = `SLOT#${slotId}#${professionalId}`;

    const item = {
      PK: `APPT#${numberId}`,
      SK: skComposite,
      userNumber: userNumber,
      title: title,
      durationMinutes: duration,
      guestEmail: guestEmail || null,
      googleEventId: googleEventId,
      professionalId: professionalId,
      userName: userName,
      meetingLink: meetingLink,
      createdAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: 'Appointments',
      Item: item,
    });

    try {
      this.logger.log(`Guardando cita en DynamoDB: ${item.PK} / ${item.SK}`);
      return await this.docClient.send(command);
    } catch (error) {
      this.logger.error('Error al guardar cita en DynamoDB', error);
      throw new Error('Error al guardar cita en DynamoDB');
    }
  }

  /**
   * Obtiene una cita específica de la tabla 'Appointments' usando PK y SK.
   * * @param numberId La WABA ID o Business ID (parte de la PK: APPT#numberId).
   * @param sk La Sort Key completa (SK: SLOT#YYYY-MM-DD HH:mm#professionalId).
   * @returns El objeto de la cita o null si no se encuentra.
   */
  async getAppointmentBySK(numberId: string, sk: string): Promise<any> {
    const pk = `APPT#${numberId}`;
    this.logger.log(`[Dynamo] Consultando cita: PK=${pk} / SK=${sk}`);

    const command = new GetCommand({
      TableName: 'Appointments', // Debe coincidir con tu nombre de tabla
      Key: {
        PK: pk, // Partition Key
        SK: sk, // Sort Key (el appointmentId del frontend)
      },
    });

    try {
      const response = await this.docClient.send(command);
      return response.Item ?? null;
    } catch (error) {
      this.logger.error(
        `Error al obtener cita ${sk} en DynamoDB`,
        error,
        'getAppointmentBySK',
      );
      // Mantenemos la convención de error del servicio
      throw new Error('Error al consultar la cita de la base de datos');
    }
  }

  /**
   * Elimina un registro de cita de la tabla 'Appointments' usando PK y SK.
   * @param numberId La WABA ID o Business ID (parte de la PK).
   * @param sk La Sort Key completa (SLOT#YYYY-MM-DD HH:mm#professionalId).
   */
  async deleteAppointment(numberId: string, sk: string): Promise<void> {
    const pk = `APPT#${numberId}`;
    this.logger.log(`Eliminando cita con PK: ${pk} y SK: ${sk}`);

    const command = new DeleteCommand({
      TableName: 'Appointments', // Debe coincidir con la tabla usada en saveAppointment
      Key: {
        PK: pk,
        SK: sk,
      },
    });

    try {
      await this.docClient.send(command);
      this.logger.log(`Ítem eliminado: ${pk} / ${sk}`);
    } catch (error) {
      this.logger.error(
        `Error al eliminar cita ${sk} en DynamoDB`,
        error,
        'deleteAppointment',
      );
      throw new Error('Error al eliminar la cita de la base de datos');
    }
  }

  // Esta función ahora debe devolver más información, no solo un Set de fechas,
  // sino un mapa o array de objetos para saber QUIÉN está ocupado.
  async getAppointmentsForRange(
    numberId: string,
    startDate: string, // Formato "YYYY-MM-DD HH:mm"
    endDate: string, // Formato "YYYY-MM-DD HH:mm"
  ): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'Appointments',
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `APPT#${numberId}`,
        ':start': `SLOT#${startDate}`, // Dynamo busca alfabéticamente, funcionará bien
        ':end': `SLOT#${endDate}~`, // El ~ asegura que incluya sufijos
      },
    });

    try {
      const { Items } = await this.docClient.send(command);

      if (!Items || Items.length === 0) {
        return []; // No hay citas ocupadas
      }

      return Items || [];
    } catch (error) {
      this.logger.error('Error al obtener rango de citas de DynamoDB', error);
      return [];
    }
  }

  /**
   * Obtiene una lista de slots de citas YA OCUPADOS para un cliente
   * dentro de un rango de fechas.
   */
  async getAppointmentsByNumberID(numberId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'Appointments',
      KeyConditionExpression: 'PK = :pk', // Solo consultamos por Partition Key
      ExpressionAttributeValues: {
        ':pk': `APPT#${numberId}`,
      },
    });

    try {
      this.logger.log(`Buscando citas para ${numberId}`);
      const { Items } = await this.docClient.send(command);

      if (!Items || Items.length === 0) {
        return [];
      }
      return Items;
    } catch (error) {
      this.logger.error('Error al obtener rango de citas de DynamoDB', error);
      return [];
    }
  }

  /**
   * Guarda la configuración de etapas del CRM para una empresa.
   * Se almacena en una tabla de configuraciones (ej. CRMSettings o reutilizando una existente con SK específico).
   */
  async saveCrmStages(numberId: string, stages: any[]): Promise<any> {
    const item = {
      number_id: numberId, // Partition Key
      stages: stages,
      updatedAt: new Date().toISOString(),
    };

    // Usamos una tabla dedicada o una genérica. Sugiero 'CRMSettings'
    const command = new PutCommand({
      TableName: 'CRMSettings',
      Item: item,
    });

    try {
      await this.docClient.send(command);
      this.logger.log(`Configuración de etapas guardada para ${numberId}`);
      return item;
    } catch (error) {
      this.logger.error('Error al guardar etapas del CRM', error);
      throw new Error('No se pudo guardar la configuración de etapas.');
    }
  }

  /**
   * Obtiene la configuración de etapas del CRM.
   */
  async getCrmStages(numberId: string): Promise<any[]> {
    const command = new GetCommand({
      TableName: 'CRMSettings',
      Key: {
        number_id: numberId,
      },
    });

    try {
      const result = await this.docClient.send(command);
      if (result.Item && result.Item.stages) {
        return result.Item.stages;
      }
      // Retornar etapas por defecto si no hay configuración previa
      return [
        { id: 'Nuevo', name: 'Nuevo Lead', color: '#3B82F6', isSystem: true },
        {
          id: 'Contactado',
          name: 'Contactado',
          color: '#6366F1',
          isSystem: false,
        },
        {
          id: 'Propuesta',
          name: 'Propuesta',
          color: '#A855F7',
          isSystem: false,
        },
        { id: 'Vendido', name: 'Vendido', color: '#22C55E', isSystem: false },
        { id: 'Perdido', name: 'Perdido', color: '#6B7280', isSystem: false },
      ];
    } catch (error) {
      this.logger.error('Error al obtener etapas del CRM', error);
      return [];
    }
  }
  /**
   * Obtiene contactos por businessId y stage de la tabla ChatControl.
   */
  async getContactsByStage(businessId: string, stage: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'ChatControl',
      KeyConditionExpression: 'businessId = :businessId',
      FilterExpression: '#stage = :stageValue',
      ExpressionAttributeNames: {
        '#stage': 'stage',
      },
      ExpressionAttributeValues: {
        ':businessId': businessId,
        ':stageValue': stage,
      },
    });

    try {
      this.logger.log(
        `Fetching contacts for business ${businessId} in stage: ${stage}`,
      );
      const { Items } = await this.docClient.send(command);
      this.logger.log(
        `Found ${Items?.length || 0} contacts in stage ${stage} for business ${businessId}`,
      );
      return Items || [];
    } catch (error) {
      this.logger.error(
        `Error fetching contacts by stage for ${businessId}/${stage}`,
        error,
      );
      return [];
    }
  }

  /**
   * Busca un disparador de Flow ACTIVO que coincida con el payload del botón.
   * AHORA USA EL GSI 'FlowTriggerNameIndex' para máxima velocidad.
   */
  async getFlowTriggerByPayload(
    numberId: string,
    triggerName: string,
  ): Promise<any | null> {
    const command = new QueryCommand({
      TableName: 'FlowTriggers',
      IndexName: 'FlowTriggerNameIndex',
      KeyConditionExpression: 'number_id = :numberId AND #name = :triggerName',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':numberId': numberId,
        ':triggerName': triggerName,
        ':active': false,
      },
    });

    try {
      this.logger.debug(
        `[Dynamo] Buscando Trigger "${triggerName}" en GSI FlowTriggerNameIndex`,
      );
      const response = await this.docClient.send(command);
      const item = response.Items?.[0] ?? null;

      if (item) {
        this.logger.debug(`[Dynamo] ✅ Trigger encontrado: ${item.name}`);
      } else {
        this.logger.warn(
          `[Dynamo] ❌ Trigger no encontrado o inactivo: ${triggerName}`,
        );
      }

      return item;
    } catch (error) {
      this.logger.error(
        `Error buscando FlowTrigger por payload: ${triggerName}`,
        error,
      );
      return null;
    }
  }

  /**
   * Obtiene el Flow por Defecto (el único que debe estar activo si no es por botón).
   * Filtra por number_id y isActive = true.
   */
  async getDefaultFlowTrigger(numberId: string): Promise<any | null> {
    const command = new QueryCommand({
      TableName: 'FlowTriggers',
      KeyConditionExpression: 'number_id = :numberId',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':numberId': numberId,
        ':active': true,
      },
    });

    try {
      this.logger.log(`Buscando Flow Default (Activo) para ${numberId}`);
      const response = await this.docClient.send(command);
      return response.Items?.[0] ?? null;
    } catch (error) {
      this.logger.error(`Error buscando Flow Default para ${numberId}`, error);
      return null;
    }
  }
  /**
   * Obtiene todos los triggers asociados a un template_id específico.
   * Esto sirve para configurar los payloads de los botones al enviar la plantilla.
   */
  async getTriggersByTemplateId(
    numberId: string,
    templateId: string,
  ): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'FlowTriggers',
      IndexName: 'TemplateIdIndex',
      KeyConditionExpression:
        'number_id = :numberId AND template_id = :templateId',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':numberId': numberId,
        ':templateId': templateId,
        ':active': false,
      },
    });

    try {
      this.logger.debug(
        `[Dynamo] Buscando triggers para template ${templateId} en GSI TemplateIdIndex`,
      );
      const response = await this.docClient.send(command);
      return response.Items || [];
    } catch (error) {
      this.logger.error(
        `Error obteniendo triggers para template ${templateId}`,
        error,
      );
      return [];
    }
  }
}
