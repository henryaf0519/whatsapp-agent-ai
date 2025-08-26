/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
/* eslint-disable @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ConfigService } from '@nestjs/config';
import {
  BatchWriteCommand,
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
      PK: `CONVERSATION#${conversationId}`,
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

    this.logger.debug('guardando informacion del mensaje: ', item);

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

  async handleAgentMessage(conversationId: string, text: string): Promise<any> {
    // Generamos la clave de ordenación (SK) con un timestamp para el orden cronológico
    const timestamp = new Date().toISOString();

    const command = new PutCommand({
      TableName: 'ConversationsTable',
      Item: {
        PK: `CONVERSATION#${conversationId}`, // La clave de partición agrupa la conversación
        SK: `MESSAGE#${timestamp}`, // La clave de ordenación para el orden
        from: 'IA',
        type: 'text',
        text: text,
        id_mensaje_wa: '',
        estado: 'SEND',
      },
    });

    try {
      const response = await this.docClient.send(command);
      await this.whatsappService.sendMessage(conversationId, text);
      return response;
    } catch (error) {
      console.error('Error al guardar el mensaje:', error);
      throw error;
    }
  }

  async getMessages(conversationId: string): Promise<any[]> {
    const command = new QueryCommand({
      TableName: 'ConversationsTable',
      KeyConditionExpression: '#pk = :pkValue',
      ExpressionAttributeNames: {
        '#pk': 'PK',
      },
      ExpressionAttributeValues: {
        ':pkValue': `CONVERSATION#${conversationId}`,
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

  async getChatMode(conversationId: string): Promise<'IA' | 'humano'> {
    const command = new GetCommand({
      TableName: 'ChatControl',
      Key: { conversationId },
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
    conversationId: string,
    newMode: 'IA' | 'humano',
  ): Promise<{ success: boolean; message: string }> {
    const command = new UpdateCommand({
      TableName: 'ChatControl',
      Key: { conversationId },
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
    conversationId: string,
    modo: 'IA' | 'humano' = 'IA',
  ): Promise<void> {
    const command = new PutCommand({
      TableName: 'ChatControl',
      Item: {
        conversationId,
        modo,
      },
      // ✅ La clave de la solución: Condición para que solo se cree si no existe
      ConditionExpression: 'attribute_not_exists(conversationId)',
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

  async findUserByEmail(email: string): Promise<any | undefined> {
    const command = new GetCommand({
      TableName: 'login',
      Key: {
        email: email,
      },
    });

    try {
      const result = await this.docClient.send(command);
      this.logger.debug('result: ', JSON.stringify(result));
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
  ): Promise<any> {
    const command = new PutCommand({
      TableName: 'login',
      Item: {
        email: email,
        password: passwordHashed,
        // ✅ CAMPOS NUEVOS AÑADIDOS AL ITEM
        waba_id: waba_id,
        whatsapp_token: whatsapp_token,
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
}
