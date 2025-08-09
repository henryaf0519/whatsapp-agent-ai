/* eslint-disable @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ConfigService } from '@nestjs/config';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import moment from 'moment-timezone';
import { v4 as uuidv4 } from 'uuid';
import { normalizeString } from '../../utils/utils';

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
  constructor(private config: ConfigService) {
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
}
