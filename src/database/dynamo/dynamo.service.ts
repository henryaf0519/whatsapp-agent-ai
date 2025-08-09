import { Injectable } from '@nestjs/common';
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
  [key: string]: unknown;
}

interface ConversationItem {
  userId: string;
  userHistory: string;
  actions?: {
    services?: string;
    activityEconomic?: string;
  };
}

interface Psychologist {
  psychologistId: string;
  id: string;
  email: string;
  [key: string]: unknown;
}

interface WorkingHours {
  startHour: number;
  endHour: number;
  slotDuration: number;
  breakStart: number;
  breakEnd: number;
  psychologistId: string;
  [key: string]: unknown;
}

@Injectable()
export class DynamoService {
  private readonly dynamoClient: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  constructor(private config: ConfigService) {
    this.dynamoClient = new DynamoDBClient({
      region: this.config.get<string>('AWS_REGION'),
    });
    this.docClient = DynamoDBDocumentClient.from(this.dynamoClient);
  }

  async guardarDato(
    payload: Record<string, unknown>,
  ): Promise<AgentScheduleItem> {
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

  async obtenerPsicologoPorNombre(
    nombre: string,
  ): Promise<Psychologist | undefined> {
    const params = {
      TableName: 'Psychologists',
      FilterExpression: 'contains(nombre, :nombre)',
      ExpressionAttributeValues: { ':nombre': nombre },
    };
    try {
      const { Items } = await this.docClient.send(new ScanCommand(params));
      const psychologists = Items as Psychologist[] | undefined;
      if (psychologists && psychologists.length) return psychologists[0];
      throw new Error('Psicólogo no encontrado');
    } catch (error) {
      console.error('Error consultando psicólogo:', error);
      return undefined;
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

  async obtenerHorarios(
    psychologistId: string,
  ): Promise<WorkingHours | undefined> {
    const params = {
      TableName: 'WorkingHours',
      IndexName: 'psychologistId-index',
      KeyConditionExpression: 'psychologistId = :pid',
      ExpressionAttributeValues: { ':pid': psychologistId },
    };
    try {
      const { Items } = await this.docClient.send(new QueryCommand(params));
      const workingHours = Items as WorkingHours[] | undefined;
      if (workingHours && workingHours.length > 0) {
        return workingHours[0];
      } else {
        throw new Error('Horarios no encontrados para este psicólogo.');
      }
    } catch (error) {
      console.error('Error obteniendo horarios:', error);
      return undefined;
    }
  }

  async obtenerCitasOcupadas(
    psychologistId: string,
    fecha: string,
  ): Promise<Set<string>> {
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
      const appointments = (
        Items as { appointmentDateTime: string }[] | undefined
      )?.map((c) => c.appointmentDateTime);
      return new Set(appointments);
    } catch (error) {
      console.error('Error obteniendo citas:', error);
      return new Set();
    }
  }

  async obtenerHuecosDisponibles(
    name: string,
    fecha: string,
  ): Promise<string | string[]> {
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

  async huecoDisponible(
    date: string,
    hour: string,
    psychologistId: string,
  ): Promise<boolean> {
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
      const citas = Items as unknown[] | undefined;
      if (citas && citas.length > 0) {
        return false;
      } else {
        return true;
      }
    } catch (error) {
      console.error('Error al validar el hueco:', error);
      return false;
    }
  }

  async createAppointment(
    date: string,
    hour: string,
    psychologistId: string,
    email: string,
  ) {
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
      console.error('Error al crear la cita:', error);
      return { success: false, message: 'Error al crear la cita' };
    }
  }

  async createUser(
    name: string,
    doc: string,
    ips: string,
    date: string,
    eps: string,
    pension: string,
    box: string,
    risk: string,
    phone: string,
    address: string,
    service: string,
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
      console.error('Error al crear registro:', error);
      return { success: false, message: 'Error al crear registro' };
    }
  }

  async crearCita(date: string, hour: string, name: string, email: string) {
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
    name: string,
    doc: string,
    ips: string,
    date: string,
    eps: string,
    pension: string,
    box: string,
    risk: string,
    phone: string,
    address: string,
    service: string,
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
      console.error('Error getting conversation history from DynamoDB', error);
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
      console.error('Error saving conversation history to DynamoDB', error);
    }
  }

  async findUser(doc: string): Promise<Record<string, unknown> | undefined> {
    const command = new GetCommand({
      TableName: 'users_monthly',
      Key: {
        id: doc,
      },
    });

    try {
      const result = await this.docClient.send(command);
      console.log('User found:', result);
      return result.Item as Record<string, unknown>;
    } catch (error) {
      console.error('Error getting conversation history from DynamoDB', error);
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
      const items = response.Items as { value: string }[] | undefined;
      if (items && items.length > 0) {
        return items[0].value;
      }
      return '';
    } catch (error) {
      console.error('Error querying DynamoDB GSI:', error);
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
      const items = response.Items as { value: string }[] | undefined;
      if (items && items.length > 0) {
        return items[0].value;
      }
      return '';
    } catch (error) {
      console.error('Error querying DynamoDB GSI:', error);
    }
  }
}
