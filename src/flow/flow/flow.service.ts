/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
<<<<<<< HEAD
=======
/* eslint-disable @typescript-eslint/no-unsafe-argument */
>>>>>>> a1024dd7971343af79b8a7b9f3867ff3aef51f2d
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { SocketGateway } from 'src/socket/socket.gateway';
import axios, { AxiosError } from 'axios';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import FormData from 'form-data';
import moment from 'moment';
import { CalendarService } from 'src/calendar/calendar.service';
import { Cron, CronExpression } from '@nestjs/schedule';

const WELCOME_OPTIONS = [
  { id: 'ABOUT_US', title: 'Quienes Somos' },
  { id: 'PRODUCTS', title: 'Precios Seguridad Social' },
  { id: 'POLICIES', title: 'Polizas de Incapacidad' },
  { id: 'MONTHLY', title: 'Pagar Mensualidad' },
  { id: 'EXTERIOR', title: 'No pensionados en el exterior' },
  { id: 'ASESOR', title: 'Hablar con un Asesor' },
];
const ECONOMIC_ACTIVITY = [
  {
    id: 'independiente',
    title: 'Independiente',
    'on-select-action': {
      name: 'update_data',
      payload: {
        independent_options_visibility: true,
        dependent_options_visibility: false,
        is_selection_complete: false,
        dependent_h: false,
        dependent_hr: false,
        dependent_hrp: false,
        dependent_hrb: false,
        dependent_hrpb: false,
        independent_hr: false,
        independent_hrp: false,
      },
    },
  },
  {
    id: 'dependiente',
    title: 'Dependiente',
    'on-select-action': {
      name: 'update_data',
      payload: {
        independent_options_visibility: false,
        dependent_options_visibility: true,
        is_selection_complete: false,
        dependent_h: false,
        dependent_hr: false,
        dependent_hrp: false,
        dependent_hrb: false,
        dependent_hrpb: false,
        independent_hr: false,
        independent_hrp: false,
      },
    },
  },
];
const INDEPENDENT_OPTIONS = [
  {
    id: 'indep_opc1',
    title: 'Salud, Riesgo (Pensionados)',
    'on-select-action': {
      name: 'update_data',
      payload: {
        independent_hr: true,
        independent_hrp: false,
        is_selection_complete: false,
      },
    },
  },
  {
    id: 'indep_opc2',
    title: 'Salud, Riesgo y Pensión',
    'on-select-action': {
      name: 'update_data',
      payload: {
        independent_hr: false,
        independent_hrp: true,
        is_selection_complete: false,
      },
    },
  },
];
const DEPENDENT_OPTIONS = [
  {
    id: 'dep_opc1',
    title: 'Salud',
    'on-select-action': {
      name: 'update_data',
      payload: {
        dependent_h: true,
        dependent_hr: false,
        dependent_hrp: false,
        dependent_hrb: false,
        dependent_hrpb: false,
      },
    },
  },
  {
    id: 'dep_opc2',
    title: 'Salud y Riesgo',
    'on-select-action': {
      name: 'update_data',
      payload: {
        dependent_h: false,
        dependent_hr: true,
        dependent_hrp: false,
        dependent_hrb: false,
        dependent_hrpb: false,
      },
    },
  },
  {
    id: 'dep_opc3',
    title: 'Salud, Riesgo y Pensión',
    'on-select-action': {
      name: 'update_data',
      payload: {
        dependent_h: false,
        dependent_hr: false,
        dependent_hrp: true,
        dependent_hrb: false,
        dependent_hrpb: false,
      },
    },
  },
  {
    id: 'dep_opc4',
    title: 'Salud, Riesgo y Caja',
    'on-select-action': {
      name: 'update_data',
      payload: {
        dependent_h: false,
        dependent_hr: false,
        dependent_hrp: false,
        dependent_hrb: true,
        dependent_hrpb: false,
      },
    },
  },
  {
    id: 'dep_opc5',
    title: 'Salud, Riesgo, Pensión y Caja',
    'on-select-action': {
      name: 'update_data',
      payload: {
        dependent_h: false,
        dependent_hr: false,
        dependent_hrp: false,
        dependent_hrb: false,
        dependent_hrpb: true,
      },
    },
  },
];

// NUEVO: Constante para las opciones de Pólizas
const POLICIES_OPTIONS = [
  { id: 'pol_opc1', title: 'Individual:  $20.000 COP' },
  { id: 'pol_opc2', title: '2 a 5 Personas:  $19.000 COP' },
  { id: 'pol_opc3', title: '6 a 10 Personas:  $17.000 COP' },
  { id: 'pol_opc4', title: '11 a 20 Personas:  $15.000 COP' },
];

const ALL_PRICE_OPTIONS = {
  independent_health_risk: [
    { id: 'indHR_opc1', title: 'Riesgo 1:  $222.000 COP' },
    { id: 'indHR_opc2', title: 'Riesgo 2:  $230.000 COP' },
    { id: 'indHR_opc3', title: 'Riesgo 3: $250.000 COP' },
    { id: 'indHR_opc4', title: 'Riesgo 4: $277.000 COP' },
    { id: 'indHR_opc5', title: 'Riesgo 5: $314.000 COP' },
  ],
  independente_HRP: [
    { id: 'indHRP_opc1', title: 'Riesgo 1:  $450.000 COP' },
    { id: 'indHRP_opc2', title: 'Riesgo 2:  $457.000 COP' },
    { id: 'indHRP_opc3', title: 'Riesgo 3: $477.000 COP' },
    { id: 'indHRP_opc4', title: 'Riesgo 4: $504.000 COP' },
    { id: 'indHRP_opc5', title: 'Riesgo 5: $542.000 COP' },
  ],
  dependent_H: [{ id: 'depH_opc1', title: '125.000 COP' }],
  dependent_HR: [
    { id: 'depHR_opc1', title: 'Riesgo 1:  $127.000 COP' },
    { id: 'depHR_opc2', title: 'Riesgo 2:  $135.000 COP' },
    { id: 'depHR_opc3', title: 'Riesgo 3: $154.000 COP' },
    { id: 'depHR_opc4', title: 'Riesgo 4: $182.000 COP' },
    { id: 'depHR_opc5', title: 'Riesgo 5: $220.000 COP' },
  ],
  dependent_HRP: [
    { id: 'depHRP_opc1', title: 'Riesgo 1:  $346.000 COP' },
    { id: 'depHRP_opc2', title: 'Riesgo 2:  $345.000 COP' },
    { id: 'depHRP_opc3', title: 'Riesgo 3: $374.000 COP' },
    { id: 'depHRP_opc4', title: 'Riesgo 4: $400.000 COP' },
    { id: 'depHRP_opc5', title: 'Riesgo 5: $438.000 COP' },
  ],
  dependent_HRB: [
    { id: 'depHRB_opc1', title: 'Riesgo 1:  $184.000 COP' },
    { id: 'depHRB_opc2', title: 'Riesgo 2:  $192.000 COP' },
    { id: 'depHRB_opc3', title: 'Riesgo 3: $212.000 COP' },
    { id: 'depHRB_opc4', title: 'Riesgo 4: $239.000 COP' },
    { id: 'depHRB_opc5', title: 'Riesgo 5: $277.000 COP' },
  ],
  dependent_HRPC: [
    { id: 'depHRPC_opc1', title: 'Riesgo 1:  $403.000 COP' },
    { id: 'depHRPC_opc2', title: 'Riesgo 2:  $410.000 COP' },
    { id: 'depHRPC_opc3', title: 'Riesgo 3:  $430.000 COP' },
    { id: 'depHRPC_opc4', title: 'Riesgo 4:  $457.000 COP' },
    { id: 'depHRPC_opc5', title: 'Riesgo 5:  $495.000 COP' },
  ],
};

const ALL_OPTIONS = [
  ...WELCOME_OPTIONS,
  ...ECONOMIC_ACTIVITY,
  ...INDEPENDENT_OPTIONS,
  ...DEPENDENT_OPTIONS,
  ...POLICIES_OPTIONS,
  ...Object.values(ALL_PRICE_OPTIONS).flat(),
];

@Injectable()
export class FlowService {
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';
  private readonly logger = new Logger(FlowService.name);
  private readonly privateKey: string | undefined;
  private readonly urlWebhook: string | undefined;
  private flowSessions: Record<string, any> = {};

  constructor(
    private readonly configService: ConfigService,
    private readonly dynamoService: DynamoService,
    private readonly socketGateway: SocketGateway,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly calendarService: CalendarService,
  ) {
    const privateKey = this.configService.get<string>(
      'WHATSAPP_FLOW_PRIVATE_KEY',
    );
    const url_webhook = this.configService.get<string>('URL_FLOW_WEBHOOK');

    if (!privateKey && !url_webhook) {
      throw new Error('WHATSAPP_FLOW_PRIVATE_KEY no está configurada!');
    }
    this.privateKey = privateKey;
    this.urlWebhook = url_webhook;
  }

  async processFlowData(body: any): Promise<string> {
    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } =
      this.decryptRequest(body, this.privateKey);
    this.logger.log(
      `[ÉXITO] Datos descifrados: ${JSON.stringify(decryptedBody)}`,
    );
    let responseData;
    const { version, action, screen, data, flow_token } = decryptedBody;
    let tokenParts: string[];
    let userNumber: string = '';
    let businessId: string = '';
    if (action !== 'ping') {
      tokenParts = flow_token.split('_');
      userNumber = tokenParts.length > 1 ? tokenParts[1] : '';
      businessId = tokenParts.length > 2 ? tokenParts[2] : 'null';
    }

    switch (action) {
      case 'ping':
        this.logger.log('Respondiendo al "ping" de la comprobación de estado.');
        responseData = { data: { status: 'active' } };
        break;

      case 'INIT':
        this.logger.log(
          'Acción "init" recibida. Enviando pantalla de bienvenida.',
        );
        responseData = {
          version,
          screen: 'WELCOME',
          data: {
            selection: WELCOME_OPTIONS,
          },
        };
        break;

      case 'data_exchange':
        this.logger.log(
          `Acción "data_exchange" recibida desde la pantalla: ${screen}`,
        );

        if (screen === 'WELCOME') {
          const nextScreen = data.selection;
          this.logger.log(
            `Navegando a la pantalla seleccionada: ${nextScreen}`,
          );
          let screenData = {};

          if (nextScreen === 'PRODUCTS') {
            screenData = {
              is_selection_complete: false,
              independent_options_visibility: false,
              dependent_options_visibility: false,
              dependent_h: false,
              dependent_hr: false,
              dependent_hrp: false,
              dependent_hrb: false,
              dependent_hrpb: false,
              independent_hr: false,
              independent_hrp: false,
              economic_activity: ECONOMIC_ACTIVITY,
              independent_options: INDEPENDENT_OPTIONS,
              dependent_options: DEPENDENT_OPTIONS,
              ...ALL_PRICE_OPTIONS,
            };
          } else if (nextScreen === 'POLICIES') {
            screenData = {
              policies_options: POLICIES_OPTIONS,
            };
          }
          // Para ABOUT_US, MONTHLY, y EXTERIOR, no se necesita enviar datos iniciales, screenData puede ser {}

          responseData = { version, screen: nextScreen, data: screenData };
        } else if (screen === 'PRODUCTS') {
          // Lógica existente para PRODUCTS...
          const findTitle = (id: string) =>
            ALL_OPTIONS.find((opt) => opt.id === id)?.title || id;
          const productSelection = {
            activity: findTitle(data.activity_type),
            plan: findTitle(data.independent_plan || data.dependent_plan),
            price: findTitle(
              data.pricesd_h ||
                data.pricesd_hr ||
                data.pricesd_hrp ||
                data.pricesd_hrb ||
                data.pricesd_hrpc ||
                data.prices_dhr ||
                data.prices_hrp,
            ),
          };
          this.flowSessions[flow_token] = { productSelection };
          this.logger.log(
            `Datos de productos guardados para la sesión ${flow_token}: ${JSON.stringify(productSelection)}`,
          );
          responseData = { version, screen: 'FINISH_FORM', data: {} };
        } else if (screen === 'FINISH_FORM') {
          // Lógica existente para FINISH_FORM...
          const formData = data;
          const sessionData = this.flowSessions[flow_token] || {};
          const { productSelection } = sessionData;
          const allData = { ...productSelection, ...formData };
          this.logger.log(
            `Todos los datos combinados: ${JSON.stringify(allData)}`,
          );
          responseData = {
            version,
            screen: 'CONFIRM',
            data: {
              details: `✅ *Resumen de tu Selección*
----------------------------------
*Actividad:* ${allData.activity || 'No especificada'}
*Plan:* ${allData.plan || 'No especificado'}
*Precio:* ${allData.price || 'No especificado'}

👤 *Tus Datos*
----------------------------------
*Nombre:* ${allData.name || ''}
*Cédula:* ${allData.doc || ''}
*Ciudad IPS:* ${allData.ips || ''}
*Fecha Ingreso:* ${allData.date || ''}
*EPS:* ${allData.eps || ''}
*Pensión:* ${allData.pension || ''}
*Caja:* ${allData.caja || ''}
*Celular:* ${allData.phone || ''}
*Dirección:* ${allData.direccion || ''}`,
            },
          };
          this.saveMessage(businessId, userNumber, responseData.data.details);

          // NUEVO: Lógica para las nuevas pantallas
        } else if (screen === 'POLICIES') {
          const selectionId = data.selection;
          const findTitle = (id: string) =>
            ALL_OPTIONS.find((opt) => opt.id === id)?.title || id;
          const policyTitle = findTitle(selectionId);

          this.logger.log(`Usuario seleccionó la póliza: ${policyTitle}`);

          responseData = {
            version,
            screen: 'CONFIRM',
            data: {
              details: `✅ *Selección de Póliza*
----------------------------------
*Póliza escogida:* ${policyTitle}`,
            },
          };

          this.saveMessage(businessId, userNumber, responseData.data.details);
        } else if (screen === 'MONTHLY') {
          const doc = data.doc;
          const flowType = 'Pago de Mensualidad';

          this.logger.log(
            `Recibido documento '${doc}' para el flujo '${flowType}'`,
          );

          const user = await this.dynamoService.findUser(doc);
          console.log('user', user);
          if (user) {
            responseData = {
              version,
              screen: 'CONFIRM',
              data: {
                details: `✅ *Solicitud Recibida*
----------------------------------
Trámite: ${flowType}
Documento: ${doc}
Nombre: ${user.nombre}
Valor a Pagar: $${user.pago.toLocaleString('es-CO')} COP
                \n`,
              },
            };
            this.saveMessage(businessId, userNumber, responseData.data.details);
          } else {
            responseData = {
              version,
              screen: 'CONFIRM',
              data: {
                details: `❌ Solicitud Rechazada*
----------------------------------
*Trámite:* ${flowType}
*Documento:* ${doc}
                \nTu documento no se encuentra en nuestra base de datos.\n\nTe invitamos a que adquieras uno de nuestros planes para poder acceder a este servicio.`,
              },
            };
            this.saveMessage(businessId, userNumber, responseData);
          }

          // Aquí iría tu lógica para buscar el documento en la base de datos.
          // Por ahora, solo confirmamos la recepción.
        } else if (screen === 'EXTERIOR') {
          const doc = data.value;
          const flowType = 'Pensionados en el Exterior';

          this.logger.log(
            `Recibido documento '${doc}' para el flujo '${flowType}'`,
          );

          // Aquí iría tu lógica para buscar el documento en la base de datos.
          // Por ahora, solo confirmamos la recepción.

          responseData = {
            version,
            screen: 'CONFIRM',
            data: {
              details: `✅ *Solicitud Recibida*
----------------------------------
*Trámite:* ${flowType}
Pago de pensión por $290,000 COP\n`,
            },
          };
          this.saveMessage(businessId, userNumber, responseData.data.details);
        } else if (screen === 'ASESOR') {
          // <--- AÑADIDO
          const question = data.question;
          this.logger.log(`Recibida pregunta para asesor: "${question}"`);
          responseData = {
            version,
            screen: 'CONFIRM',
            data: {
              details: `✅ *Consulta Enviada*
----------------------------------
*Tu pregunta:* ${question}
\n`,
            },
          };
          this.saveMessage(businessId, userNumber, responseData.data.details);
        } else if (screen === 'CONFIRM') {
          this.logger.log(
            `Flujo completado por el usuario desde la pantalla CONFIRM.`,
          );
          delete this.flowSessions[flow_token];
          this.logger.log(`Sesión ${flow_token} limpiada.`);
          responseData = { version: version, data: { success: true } };
        } else {
          this.logger.warn(
            `Data exchange desde una pantalla no manejada: ${screen}`,
          );
          responseData = { version, screen: 'WELCOME', data: {} };
        }
        break;

      default:
        this.logger.warn(`Acción no reconocida recibida: ${action}`);
        responseData = { version, screen: 'WELCOME', data: {} };
        break;
    }

    return Promise.resolve(
      this.encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer),
    );
  }

  async processDynamicFlowData(body: any): Promise<string> {
    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } =
      this.decryptRequest(body, this.privateKey);

    this.logger.log(
      `[DYN] Datos descifrados: ${JSON.stringify(decryptedBody)}`,
    );

    const { version, action, screen, data, flow_token } = decryptedBody;

    // 1. Manejar 'ping' (comprobación de estado)
    if (action === 'ping') {
      this.logger.log('Respondiendo al "ping" de la comprobación de estado.');
      const responseData = { data: { status: 'active' } };
      return this.encryptResponse(
        responseData,
        aesKeyBuffer,
        initialVectorBuffer,
      );
    }

    // 2. Extraer identificadores y cargar el JSON del flujo
    const { numberId, userNumber, flow_id } = this._parseFlowToken(flow_token);
    if (!flow_id || !numberId || !userNumber) {
      this.logger.error(
        `[DYN] flow_token o flow_id faltantes. Token: ${flow_token}, ID: ${flow_id}`,
      );
      throw new Error('No se pudo parsear flow_token o falta flow_id');
    }

    const fullFlowData = await this._getFlowJson(numberId, flow_id);
    const { flowJson, flowNavigate } = fullFlowData;

    if (!flowJson || !flowNavigate) {
      this.logger.error(
        `[DYN] El JSON del flujo ${flow_id} no tiene la estructura esperada { flowJson: ..., flowNavigate: ... }`,
      );
      throw new Error('Estructura de JSON de flujo inválida');
    }

    const currentSessionData = this.flowSessions[flow_token]?.data || {};
    const newSessionData = { ...currentSessionData, ...data };
    this.flowSessions[flow_token] = {
      timestamp: Date.now(),
      data: newSessionData,
    };

    let responseData: any;

    // 4. Enrutar la acción
    switch (action) {
      case 'INIT': {
        this.logger.log(`[DYN] Acción INIT para ${flow_id}`);
        this.flowSessions[flow_token] = { timestamp: Date.now(), data: {} };
        const startScreenId = Object.keys(flowJson.routing_model)[0];

        responseData = {
          version,
          screen: startScreenId,
          data: {},
        };
        break;
      }

      case 'data_exchange': {
        if (data && data.flow_completed === 'true') {
          // --- FLUJO FINALIZADO ---
          this.logger.log(
            `[DYN] ¡Flujo finalizado por el usuario en la pantalla ${screen}!`,
          );

          // Ejecuta la lógica de negocio (agendar, etc.) y guarda el resumen
          await this._executeFlowCompletionLogic(
            newSessionData,
            flowNavigate,
            flowJson,
            numberId,
            userNumber,
            flow_token,
          );

          // Responde a Meta para cerrar el flow
          responseData = this._createSuccessResponse(data.flow_token);
        } else {
          // --- FLUJO EN CURSO (NAVEGACIÓN) ---

          // 1. Decide cuál es la siguiente pantalla
          const nextScreenId = this._determineNextScreen(
            screen,
            data,
            flowNavigate,
            flowJson,
          );

          if (nextScreenId) {
            // 2. Prepara la respuesta para esa pantalla (con datos si es necesario)
            responseData = await this._prepareNextScreenResponse(
              nextScreenId,
              flowNavigate,
              flowJson,
              newSessionData,
              numberId,
              data,
              version,
            );
          } else {
            // 3. Si no hay siguiente pantalla, el flujo termina
            this.logger.log(
              `[DYN] Pantalla terminal '${screen}' alcanzada. Enviando respuesta de finalización.`,
            );
            responseData = this._createSuccessResponse(data.flow_token);
          }
        }
        break;
      }

      case 'complete': {
        // Este caso es similar a 'flow_completed: true', manejamos la lógica
        this.logger.log(`[DYN] Acción 'complete' recibida desde: ${screen}`);

        await this._executeFlowCompletionLogic(
          newSessionData,
          flowNavigate,
          flowJson,
          numberId,
          userNumber,
          flow_token,
        );
        delete this.flowSessions[flow_token]; // Limpiar la sesión

        responseData = { version, data: { success: true } };
        break;
      }

      default:
        this.logger.warn(`Acción no reconocida recibida: ${action}`);
        throw new Error(`Acción no soportada: ${action}`);
    }

    // 5. Encriptar y devolver la respuesta
    return this.encryptResponse(
      responseData,
      aesKeyBuffer,
      initialVectorBuffer,
    );
  }

  // --- NUEVOS HELPERS PRIVADOS ---

  /**
   * Extrae el numberId (businessId) y userNumber (teléfono) del flow_token.
   */
  private _parseFlowToken(flow_token: string): {
    numberId: string;
    flow_id: string;
    userNumber: string;
  } {
    try {
      const parts = flow_token.split('_');
      const userNumber = parts[1];
      const numberId = parts[2]; // businessId
      const flow_id = parts[3];
      this.logger.log(`[DYN] numberId: ${numberId}, userNumber: ${userNumber}`);
      if (!userNumber || !numberId || !flow_id) {
        throw new Error('Formato de flow_token inválido');
      }
      return { numberId, userNumber, flow_id };
    } catch (error) {
      this.logger.error(`Error parseando flow_token: ${flow_token}`, error);
      throw new Error('flow_token inválido');
    }
  }

  /**
   * Obtiene y parsea el JSON de la definición del flujo desde DynamoDB.
   */
  private async _getFlowJson(numberId: string, flowId: string): Promise<any> {
    const definitionItem = await this.dynamoService.getClientFlowDefinition(
      numberId,
      flowId,
    );

    if (!definitionItem || !definitionItem.flow_definition) {
      this.logger.error(
        `[DYN] No se encontró flow_definition para numberId: ${numberId}, flowId: ${flowId}`,
      );
      throw new NotFoundException('Definición de flujo no encontrada.');
    }

    try {
      // El JSON está guardad o como un string, necesitamos parsearlo
      return {
        flowJson: JSON.parse(definitionItem.flow_definition),
        flowNavigate: JSON.parse(definitionItem.navigation),
      };
    } catch (error) {
      this.logger.error(
        `[DYN] Error parseando JSON para flowId: ${flowId}`,
        error,
      );
      throw new Error('Error al parsear la definición del flujo.');
    }
  }
  /**
   * Construye un resumen (detalles) profesional iterando sobre el flow.json
   * para encontrar solo los campos de formulario y sus labels/names.
   */
  private _buildDynamicDetails(
    newSessionData: any,
    flowNavigate: any,
    flowJson: any,
    title?: string,
  ): string {
    const details: string[] = [];

    if (title) {
      details.push(title);
    } else {
      details.push('✅ Resumen de tu solicitud:');
    }

    const processedFields = new Set<string>();
    for (const screen of flowJson.screens) {
      const form = screen.layout?.children?.find(
        (child: any) => child.type === 'Form',
      );
      if (!form || !form.children) {
        continue;
      }

      for (const field of form.children) {
        const fieldName = field.name;
        const fieldType = field.type;
        if (!fieldName || processedFields.has(fieldName)) {
          continue;
        }
        const value = newSessionData[fieldName];
        if (!value) {
          continue;
        }

        let formattedKey = '';

        if (fieldName === 'date') {
          formattedKey = 'Cita seleccionada';
        } else if (
          fieldType === 'RadioButtonsGroup' ||
          (fieldType === 'Dropdown' && fieldName !== 'date')
        ) {
          formattedKey = 'Seleccionaste';
        } else if (field.label) {
          formattedKey = field.label.replace(':', '');
        } else {
          formattedKey = fieldName
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
        }
        let readableValue = String(value);
        if (
          readableValue.startsWith('opcion_') ||
          readableValue.startsWith('cat_opt_')
        ) {
          if (
            flowNavigate[readableValue] &&
            flowNavigate[readableValue].valor
          ) {
            readableValue = flowNavigate[readableValue].valor;
          } else {
            continue;
          }
        }

        details.push(`${formattedKey}: ${readableValue}`);
        processedFields.add(fieldName);
      }
    }

    if (processedFields.size === 0) {
      details.push(
        'Tu solicitud ha sido registrada.',
        'Un agente se comunicará contigo.',
      );
    }

    return details.join('\n');
  }

  private decryptRequest(
    body: any,
    privatePem: string | undefined,
  ): { aesKeyBuffer: Buffer; initialVectorBuffer: Buffer; decryptedBody: any } {
    if (!privatePem) {
      throw new Error('WHATSAPP_FLOW_PRIVATE_KEY no está configurada!');
    }
    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
    const base64Key = privatePem
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    const formattedPrivateKey = `-----BEGIN PRIVATE KEY-----\n${base64Key.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END PRIVATE KEY-----\n`;
    const decryptedAesKey = crypto.privateDecrypt(
      {
        key: crypto.createPrivateKey(formattedPrivateKey),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encrypted_aes_key, 'base64'),
    );
    const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
    const initialVectorBuffer = Buffer.from(initial_vector, 'base64');
    const TAG_LENGTH = 16;
    const encrypted_flow_data_body = flowDataBuffer.subarray(0, -TAG_LENGTH);
    const encrypted_flow_data_tag = flowDataBuffer.subarray(-TAG_LENGTH);
    const decipher = crypto.createDecipheriv(
      'aes-128-gcm',
      decryptedAesKey,
      initialVectorBuffer,
    );
    decipher.setAuthTag(encrypted_flow_data_tag);
    const decryptedJSONString = Buffer.concat([
      decipher.update(encrypted_flow_data_body),
      decipher.final(),
    ]).toString('utf-8');
    return {
      decryptedBody: JSON.parse(decryptedJSONString),
      aesKeyBuffer: decryptedAesKey,
      initialVectorBuffer,
    };
  }

  private encryptResponse(
    response: any,
    aesKeyBuffer: Buffer,
    initialVectorBuffer: Buffer,
  ): string {
    const flipped_iv_array: number[] = [];
    for (const pair of initialVectorBuffer.entries()) {
      flipped_iv_array.push(~pair[1]);
    }
    const flipped_iv = Buffer.from(flipped_iv_array);
    const cipher = crypto.createCipheriv(
      'aes-128-gcm',
      aesKeyBuffer,
      flipped_iv,
    );
    return Buffer.concat([
      cipher.update(JSON.stringify(response), 'utf-8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
  }

  private async saveMessage(
    businessId: string,
    userNumber: string,
    details: any,
  ) {
    await this.dynamoService.saveMessage(
      businessId,
      userNumber,
      userNumber,
      details || '',
      '',
      'RECEIVED',
      'respflow',
      '',
    );
    const sendSocketUser = {
      from: userNumber,
      text: details || '',
      type: 'respflow',
      url: '',
      SK: `MESSAGE#${new Date().toISOString()}`,
    };
    this.socketGateway.sendNewMessageNotification(
      businessId,
      userNumber,
      sendSocketUser,
    );
  }

  async createFlow(
    wabaId: string,
    numberId: string,
    name: string,
    categories: string[] = ['OTHER'],
  ) {
    const token = await this.whatsappService.getWhatsappToken(numberId);
    const url = `${this.baseUrl}/${wabaId}/flows`;

    const form = new FormData();
    form.append('name', name);
    form.append('categories', JSON.stringify(categories));

    try {
      const response = await axios.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Error al crear el flow "${name}"`, error);
      this.throwMetaError(error, 'Error al crear el flow');
    }
  }

  /**
   * 2. Obtener un Flow específico por su ID
   * Corresponde a: GET /{flow_id}
   */
  async getFlowById(flowId: string, numberId: string) {
    const token = await this.whatsappService.getWhatsappToken(numberId);
    let flowJsonContent: any = null; // Default a null si no se encuentra
    let flowN: any = null;
    try {
      // Usamos el token que ya teníamos para llamar a nuestra nueva función helper
      const flowJson = await this.getFlowJsonContentHelper(flowId, token);
      flowJsonContent = flowJson;

      flowN = await this.dynamoService.getClientFlowDefinition(
        numberId,
        flowId,
      );
    } catch (error) {
      // Es normal que falle si el flow está en DRAFT y nunca se le ha subido un JSON
      this.logger.warn(
        `No se pudo obtener el flow.json para ${flowId} (puede ser un flow vacío). Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // No relanzamos el error, solo dejamos el JSON como null
    }

    return {
      flow_json: flowJsonContent,
      navigation: JSON.parse(flowN?.navigation) || null,
    };
  }

  private async getFlowJsonContentHelper(
    flowId: string,
    token: string,
  ): Promise<any> {
    const assetsUrl = `${this.baseUrl}/${flowId}/assets`;
    const assetsResponse = await axios.get(assetsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const flowJsonAsset = assetsResponse.data?.data?.find(
      (asset: any) => asset.asset_type === 'FLOW_JSON',
    );

    if (!flowJsonAsset || !flowJsonAsset.download_url) {
      this.logger.warn(
        `No se encontró un asset 'FLOW_JSON' con download_url para el flow ${flowId}`,
      );
      return null;
    }

    const downloadUrl = flowJsonAsset.download_url;
    const jsonResponse = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return jsonResponse.data;
  }

  /**
   * 3. Obtener todos los Flows de una WABA
   * Corresponde a: GET /{waba_id}/flows
   */
  async getFlows(wabaId: string, numberId: string) {
    const token = await this.whatsappService.getWhatsappToken(numberId);
    const url = `${this.baseUrl}/${wabaId}/flows`;

    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error al obtener flows para WABA ID: ${wabaId}`,
        error,
      );
      this.throwMetaError(error, 'Error al obtener la lista de flows');
    }
  }

  /**
   * 4. Actualizar el contenido de un Flow (subiendo el flow.json)
   * Corresponde a: POST /{flow_id}/assets
   */
  async updateFlowAssets(
    flowId: string,
    numberId: string,
    flowJson: string,
    navigation: string,
  ) {
    this.logger.log(
      `Actualizando assets (flow.json) para el Flow ID: ${flowId}, Cliente: ${numberId}`,
    );

    const token = await this.whatsappService.getWhatsappToken(numberId);
    const url = `${this.baseUrl}/${flowId}/assets`;

    const form = new FormData();
    form.append('name', 'flow.json');
    form.append('asset_type', 'FLOW_JSON');
    form.append('file', Buffer.from(flowJson, 'utf-8'), {
      filename: 'flow.json',
      contentType: 'application/json; charset=utf-8',
    });

    try {
      this.logger.log(`Enviando actualización a Meta API para ${flowId}...`);
      const response = await axios.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });
      try {
        await this.dynamoService.saveClientFlowDefinition(
          numberId,
          flowId,
          flowJson,
          navigation,
          `Definición de flujo para ${flowId}`,
        );

        this.logger.log(`¡Flujo ${flowId} guardado en DynamoDB exitosamente!`);
      } catch (dynamoError) {
        this.logger.error(
          `¡INCONSISTENCIA! El flujo ${flowId} se actualizó en Meta, pero falló al guardar en DynamoDB.`,
          dynamoError,
        );
        // Retornamos el éxito de Meta, pero con una advertencia.
        return {
          ...response.data,
          dynamo_db_status: 'failed',
          warning: 'Flow updated in Meta but failed to save in DynamoDB.',
        };
      }
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Error al actualizar assets para flow en Meta: ${flowId}`,
        error?.response?.data || error?.message, // Mostrar el error de Meta si está disponible
      );

      // Re-utilizamos tu función de manejo de errores
      this.throwMetaError(error, 'Error al actualizar el flow');
    }
  }

  /**
   * 5. Eliminar un Flow
   * Corresponde a: DELETE /{flow_id}
   */
  async deleteFlow(flowId: string, numberId: string) {
    this.logger.log(`Eliminando Flow con ID: ${flowId}`);
    const token = await this.whatsappService.getWhatsappToken(numberId);
    const url = `${this.baseUrl}/${flowId}`;

    try {
      const response = await axios.delete(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Error al eliminar flow: ${flowId}`, error);
      this.throwMetaError(error, 'Error al eliminar el flow');
    }
  }

  /**
   * 6. Publicar un Flow
   * Corresponde a: POST /{flow-id}/publish
   */

  async publishFlow(flowId: string, name: string, numberId: string) {
    this.logger.log(`Iniciando publicación de Flow ID: ${flowId}`);
    const token = await this.whatsappService.getWhatsappToken(numberId);

    const metadataUrl = `${this.baseUrl}/${flowId}`;
    const form = new FormData();
    form.append('name', name);
    form.append('categories', '["OTHER"]');
    form.append('endpoint_uri', this.urlWebhook || '');

    try {
      await axios.post(metadataUrl, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });
      this.logger.log(`Endpoint URI asignado exitosamente.`);
    } catch (error) {
      this.logger.error(
        `Error al asignar Endpoint URI para flow: ${flowId}`,
        error,
      );
      this.throwMetaError(error, 'Error al asignar el Endpoint URI');
    }

    this.logger.log(`Intentando publicar el flow...`);
    const publishUrl = `${this.baseUrl}/${flowId}/publish`;

    try {
      const response = await axios.post(publishUrl, null, {
        headers: { Authorization: `Bearer ${token}` },
      });
      this.logger.log(`Flow ${flowId} publicado exitosamente.`);
      return response.data; // Devuelve { "success": true }
    } catch (error) {
      this.logger.error(`Error al publicar flow: ${flowId}`, error);
      this.throwMetaError(
        error,
        'Error al publicar el flow (después de asignar el URI)',
      );
    }
  }

  /**
   * Envía un mensaje de prueba de un flujo a un número específico.
   * @param flowId ID interno del flujo (de DynamoDB)
   * @param userId ID del usuario (para obtener credenciales)
   * @param to Número de teléfono de destino (ej: 573001234567)
   */

  async sendTestFlow(
    flowId: string,
    flowName: string,
    to: string,
    screen: string,
    number_id,
  ) {
    this.logger.log(`Iniciando envío de prueba para flow ${flowId} a ${to}`);

    if (!to || !number_id || !flowId || !screen || !flowName) {
      throw new NotFoundException(
        'Faltan datos en el payload (to, number_id, flowId, screen, o flowName)',
      );
    }

    const token = await this.whatsappService.getWhatsappToken(number_id);
    if (!token) {
      throw new NotFoundException(
        `No se encontró token para number_id: ${number_id}`,
      );
    }

    try {
      this.logger.log(`Paso 1/2: Verificando Endpoint URI...`);
      await this.updateFlowEndpointUri(flowId, flowName, token);
      this.logger.log(`Paso 1/2: Endpoint URI verificado.`);
    } catch (error) {
      this.logger.error(`Error al publicar flow: ${flowId}`, error);
      this.throwMetaError(
        error,
        'Error al publicar el flow (después de asignar el URI)',
      );
    }

    const flowToken = `token_${to}_${number_id}_${flowId}_${Date.now()}`;

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      recipient_type: 'individual',
      type: 'interactive',
      interactive: {
        type: 'flow',
        header: { type: 'text', text: 'Prueba de Flujo' },
        body: { text: `Iniciando prueba` },
        footer: { text: 'Haz clic para comenzar' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_action: 'navigate',
            flow_token: flowToken,
            flow_id: flowId,
            flow_cta: 'Iniciar Flujo',
            mode: 'draft',
            flow_action_payload: {
              screen: screen,
            },
          },
        },
      },
    };

    // 6. Enviar usando WhatsappService
    this.logger.log(
      `Enviando payload de prueba a Graph API: ${JSON.stringify(payload)}`,
    );
    await this.whatsappService.sendFlowDraft(to, number_id, token, payload);

    return { success: true, message: `Prueba enviada a ${to}` };
  }

  /**
   * Actualiza la 'endpoint_uri' (webhook) de un flujo en Meta.
   */
  async updateFlowEndpointUri(flowId: string, flowName: string, token: string) {
    this.logger.log(`Actualizando Endpoint URI para Flow ID: ${flowId}`);

    const metadataUrl = `${this.baseUrl}/${flowId}`;
    const form = new FormData();
    form.append('name', flowName); // El nombre es requerido por la API
    form.append('categories', '["OTHER"]');
    form.append('endpoint_uri', this.urlWebhook || ''); // El webhook

    try {
      // Usamos el httpService de NestJS (wrapper de Axios)
      await axios.post(metadataUrl, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });
      this.logger.log(`Endpoint URI asignado exitosamente para ${flowId}.`);
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Error al asignar Endpoint URI para flow: ${flowId}`,
        error,
      );
      this.throwMetaError(error, 'Error al asignar el Endpoint URI');
    }
  }

  /**
   * Helper para manejar errores de la API de Meta
   * (Copiado de whatsapp.service.ts para consistencia)
   */
  private throwMetaError(error: any, defaultMessage: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error;
      const errorMessage =
        axiosError.response?.data?.error?.message || defaultMessage;
      const errorStatus =
        axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;

      this.logger.error(
        `Error de la API de Meta [${errorStatus}]: ${errorMessage}`,
      );
      this.logger.debug(
        `Respuesta completa del error: ${JSON.stringify(axiosError.response?.data)}`,
      );

      throw new HttpException(
        {
          message: `Error de la API de Meta: ${errorMessage}`,
          metaError: axiosError.response?.data?.error,
        },
        errorStatus,
      );
    }

    // Para cualquier otro tipo de error inesperado
    this.logger.error(
      `Error inesperado no relacionado con Axios: ${error.message}`,
    );
    throw new HttpException(defaultMessage, HttpStatus.INTERNAL_SERVER_ERROR);
  }
  /**
   * Maneja la lógica de los dataSourceTriggers del __SCREEN_CONFIG__
   * Esta función actúa como un enrutador para llamar a la lógica correcta.
   */
  /**
   * Maneja la lógica de los dataSourceTriggers del __SCREEN_CONFIG__
   */
  private async _handleDataSourceTrigger(
    trigger: string,
    config: any, // Aquí viene la config del nodo (incluyendo resourceMapping)
    numberId: string,
    data: any,
  ): Promise<Record<string, any>> {
    this.logger.log(`[DYN] Ejecutando dataSourceTrigger: ${trigger}`);

    switch (trigger) {
      case 'fetch_available_dates':
        // --- 1. DETECCIÓN ROBUSTA DEL PROFESIONAL ---
        let selectedProfessionalId = 'any_professional'; // Default
        let rawOptionFound = '';

        const resourceMapping = config.resourceMapping || {};

        // Recorremos TODOS los valores recibidos en 'data'.
        // Meta envía algo como: { "seleccion_usuario": "opcion_1763..." }
        const dataValues = Object.values(data);

        for (const val of dataValues) {
          // Verificamos si el valor es un string Y si existe como llave en nuestro mapa
          if (typeof val === 'string') {
            const cleanVal = val.trim();
            if (resourceMapping[cleanVal]) {
              // ¡ENCONTRADO! El usuario seleccionó esta opción
              selectedProfessionalId = resourceMapping[cleanVal].id; // Ej: "henry_arevalo"
              rawOptionFound = cleanVal;
              break; // Dejamos de buscar
            }
          }
        }

        this.logger.log(
          `[DYN] Buscando disponibilidad para: ${selectedProfessionalId} (Raw: ${rawOptionFound || 'Ninguno/Default'})`,
        );

        // --- 2. GENERAR FECHAS FILTRADAS ---
        const dates = await this._generateAvailableDates(
          config,
          numberId,
          selectedProfessionalId, // Ahora sí lleva "henry_arevalo"
          resourceMapping,
        );
        return { date: dates };

      default:
        this.logger.warn(`[DYN] dataSourceTrigger no reconocido: ${trigger}`);
        return {};
    }
  }

  /**
   * Genera una lista de SLOTS DE CITA (fecha y hora) disponibles
   * 1. Genera slots estáticos (días, horas, breaks)
   * 2. Consulta DynamoDB por slots ya ocupados
   * 3. Filtra la lista estática y devuelve solo los slots libres.
   */
  /**
   * Genera una lista de SLOTS DE CITA (fecha y hora) disponibles
   * Ahora soporta filtrado por profesional específico.
   */
  private async _generateAvailableDates(
    config: any,
    numberId: string,
    selectedProfessionalId: string = 'any_professional', // <--- PARÁMETRO 3 AÑADIDO
    resourceMapping: Record<string, any> = {}, // <--- PARÁMETRO 4 AÑADIDO
  ): Promise<{ id: string; title: string }[]> {
    const {
      daysToShow,
      daysAvailable,
      startTime,
      endTime,
      intervalMinutes,
      breakTimes,
    } = config;

    const availableSlots: { id: string; title: string }[] = [];
    const timeZone = 'America/Bogota';
    const minimumSlotTime = moment.tz(timeZone).add(2, 'hours');

    // 1. Extraer todos los SLUGs válidos (para calcular capacidad máxima)
    const allResources = Object.values(resourceMapping) as any[];
    const allResourceIds = allResources
      .map((r) => r.id)
      .filter((id) => id !== 'any_professional');

    // Si no hay recursos mapeados, asumimos capacidad 1 (Agenda única)
    const maxCapacity =
      allResourceIds.length > 0 ? new Set(allResourceIds).size : 1;

    const queryStartDate = minimumSlotTime.format('YYYY-MM-DD HH:mm');
    const queryEndDate = moment
      .tz(timeZone)
      .add(30, 'days')
      .endOf('day')
      .format('YYYY-MM-DD HH:mm');

    const rawAppointments = await this.dynamoService.getAppointmentsForRange(
      numberId,
      queryStartDate,
      queryEndDate,
    );
    const busySlots = new Set<string>();


    const slotOccupationMap: Record<string, Set<string>> = {};

    // Iteramos sobre lo que devuelve getAppointmentsForRange (que ahora devuelve un Set de strings 'SK')
    // OJO: getAppointmentsForRange en DynamoService devuelve un Set<string> de los SKs ocupados?
    // Si lo modificamos para devolver items completos (any[]), debemos iterar sobre items.
    // ASUMIENDO que getAppointmentsForRange devuelve any[] (los items completos):

    /* NOTA IMPORTANTE: Asegúrate que en DynamoService getAppointmentsForRange retorne 'Items' (array),
       no un Set<string>, para poder leer el 'professionalId'.
       Si devuelve Set, la lógica de abajo fallará. 
       
       Voy a escribir esto asumiendo que getAppointmentsForRange devuelve any[] como acordamos.
    */

    // Si rawAppointments es un Set (versión antigua), hay que corregir DynamoService primero.
    // Asumiremos que es un Array de objetos aquí:
    const appointmentsArray = Array.from(rawAppointments);

    appointmentsArray.forEach((appt: any) => {
      // El SK viene como "SLOT#2025-11-25 10:00#henry_arevalo" (o similar)
      // O si rawAppointments es un Set de strings, necesitamos parsearlo.

      // Si appt es un objeto completo de Dynamo:
      let slotTimeStr = '';
      let apptProfId = 'any_professional';

      if (typeof appt === 'string') {
        // Fallback por si acaso sigue llegando string
        const parts = appt.split('#');
        if (parts.length >= 2) slotTimeStr = parts[0]; // Ajustar según formato string
      } else if (appt.SK) {
        const parts = appt.SK.split('#');
        if (parts.length >= 2) {
          slotTimeStr = parts[1]; // "2025-11-25 10:00"
        }
        apptProfId = appt.professionalId || 'any_professional';
      }

      if (!slotTimeStr) return;

      // Lógica A: Usuario pidió un profesional ESPECÍFICO (ej: Henry)
      if (selectedProfessionalId !== 'any_professional') {
        // Si la cita en BD es de Henry, bloqueamos el slot
        if (apptProfId === selectedProfessionalId) {
          busySlots.add(slotTimeStr);
        }
      }
      // Lógica B: Usuario pidió CUALQUIERA (o Agenda General)
      else {
        if (!slotOccupationMap[slotTimeStr]) {
          slotOccupationMap[slotTimeStr] = new Set();
        }
        slotOccupationMap[slotTimeStr].add(apptProfId);
      }
    });

    // Procesar ocupación para modo "Cualquiera"
    if (selectedProfessionalId === 'any_professional') {
      // Guardamos en sesión para usarlo al agendar
      if (!this.flowSessions.slotOccupation) {
        this.flowSessions.slotOccupation = {};
      }

      for (const [slot, busyProfs] of Object.entries(slotOccupationMap)) {
        this.flowSessions.slotOccupation[slot] = busyProfs;

        // Si TODOS los recursos están ocupados (o si es agenda única y hay 1 cita)
        if (busyProfs.size >= maxCapacity) {
          busySlots.add(slot);
        }
      }
    }

    // 4. Loop de Generación de Slots (Igual que antes)
    const currentDate = moment.tz(timeZone).startOf('day');
    let daysFound = 0;

    for (let i = 0; i < 30 && daysFound < daysToShow; i++) {
      const dayOfWeek = currentDate.day();
      if (!daysAvailable.includes(dayOfWeek)) {
        currentDate.add(1, 'day');
        continue;
      }
      daysFound++;

      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const slotTime = currentDate
        .clone()
        .hour(startH)
        .minute(startM)
        .second(0);
      const endLoopTime = currentDate.clone().hour(endH).minute(endM).second(0);

      while (slotTime.isBefore(endLoopTime)) {
        const slotId = slotTime.format('YYYY-MM-DD HH:mm');

        if (slotTime.isBefore(minimumSlotTime)) {
          slotTime.add(intervalMinutes, 'minutes');
          continue;
        }

        let isInBreak = false;
        if (breakTimes && breakTimes.length > 0) {
          for (const breakTime of breakTimes) {
            const [breakStartH, breakStartM] = breakTime.start
              .split(':')
              .map(Number);
            const [breakEndH, breakEndM] = breakTime.end.split(':').map(Number);
            const breakStart = currentDate
              .clone()
              .hour(breakStartH)
              .minute(breakStartM);
            const breakEnd = currentDate
              .clone()
              .hour(breakEndH)
              .minute(breakEndM);
            if (
              slotTime.isSameOrAfter(breakStart) &&
              slotTime.isBefore(breakEnd)
            ) {
              isInBreak = true;
              break;
            }
          }
        }
        if (isInBreak) {
          slotTime.add(intervalMinutes, 'minutes');
          continue;
        }

        // Validar contra los slots ocupados calculados arriba
        if (busySlots.has(slotId)) {
          slotTime.add(intervalMinutes, 'minutes');
          continue;
        }

        availableSlots.push({
          id: slotId,
          title: slotTime.clone().locale('es').format('ddd MMM DD YYYY HH:mm'),
        });

        slotTime.add(intervalMinutes, 'minutes');
      }
      currentDate.add(1, 'day');
    }

    return availableSlots;
  }

  /**
   * Ejecuta la lógica de negocio al finalizar un flujo.
   * (Crea citas de calendario, guarda resumen, etc.)
   */
  private async _executeFlowCompletionLogic(
    newSessionData: any,
    flowNavigate: any,
    flowJson: any,
    numberId: string,
    userNumber: string,
    flow_token: string,
  ): Promise<void> {
    try {
      // 1. Intentar crear la cita en el calendario si el flujo lo define
      await this._createCalendarEvent(
        newSessionData,
        flowNavigate,
        numberId,
        userNumber,
      );

      // 2. Guardar el resumen final en la base de datos y notificar al socket
      const details = this._buildDynamicDetails(
        newSessionData,
        flowNavigate,
        flowJson,
      );
      await this.saveMessage(numberId, userNumber, details);
      this.logger.log(
        `[DYN] Resumen generado y guardado: ${JSON.stringify(details)}`,
      );
      delete this.flowSessions[flow_token];
      this.logger.log(`[DYN] Sesión ${flow_token} finalizada y limpiada.`);
    } catch (e) {
      delete this.flowSessions[flow_token];
      this.logger.error(
        `[DYN] Error durante la ejecución de fin de flujo: ${e}`,
      );
    }
  }

  private async _createCalendarEvent(
    newSessionData: any,
    flowNavigate: any,
    numberId: string,
    userNumber: string,
  ): Promise<void> {
    const screenConfig = flowNavigate.__SCREEN_CONFIG__?.SCREENS;
    if (!screenConfig) return;

    const appointmentScreenKey = Object.keys(screenConfig).find(
      (key) => screenConfig[key].type === 'appointmentNode',
    );
    if (!appointmentScreenKey) return;

    const apptConfig = screenConfig[appointmentScreenKey].config;
    const tool = apptConfig.tool;
    const selectedSlot = newSessionData.date;

    // 1. CARGAR MAPA Y VALIDAR
    const resourceMapping = apptConfig.resourceMapping || {};
    const hasResources = Object.keys(resourceMapping).length > 0;

    if (!selectedSlot || tool !== 'google_calendar') {
      this.logger.warn(
        `[DYN] Flow finalizado sin slot o herramienta incorrecta.`,
      );
      return;
    }

    const [date, time] = selectedSlot.split(' ');
    let title = apptConfig.appointmentDescription || 'Cita Agendada';
    const duration = apptConfig.intervalMinutes || 60;

    // Variables por defecto
    let selectedProfessionalId = 'any_professional';
    let professionalDisplayName = '';

    // --- 2. INTENTAR DETECTAR SELECCIÓN (CON DEBUGGING) ---
    if (hasResources) {
      const sessionValues = Object.values(newSessionData);
      let foundMapping: any = null;

      // DEBUG: Ver qué valores tenemos y qué llaves esperamos
      // (Esto te ayudará a ver en la consola por qué no coinciden)
      this.logger.debug(
        `[DYN] Valores en Sesión: ${JSON.stringify(sessionValues)}`,
      );
      this.logger.debug(
        `[DYN] Llaves en Mapping: ${JSON.stringify(Object.keys(resourceMapping))}`,
      );

      for (const value of sessionValues) {
        // Aseguramos que sea string y quitamos espacios por si acaso
        if (typeof value === 'string') {
          const cleanValue = value.trim();
          if (resourceMapping[cleanValue]) {
            foundMapping = resourceMapping[cleanValue];
            this.logger.log(
              `[DYN] ✅ Match encontrado: ${cleanValue} -> ${foundMapping.id}`,
            );
            break;
          }
        }
      }

      if (foundMapping) {
        selectedProfessionalId = foundMapping.id;
        professionalDisplayName = foundMapping.nombre;
      } else {
        this.logger.warn(
          `[DYN] ⚠️ No se encontró match en el mapping. Se usará lógica 'any_professional'.`,
        );
        return;
      }
    }

    // --- 3. LÓGICA ALEATORIA / AGENDA GENERAL ---

    // CASO A: Es 'any_professional' Y tenemos recursos configurados (Modo Aleatorio)
    if (selectedProfessionalId === 'any_professional' && hasResources) {
      const allResources = Object.values(resourceMapping) as any[];

      // IDs reales para elegir (excluyendo el ID 'any_professional' si existe en el mapa)
      const allResourceIds = allResources
        .map((r) => r.id)
        .filter((id) => id !== 'any_professional');

      const occupation =
        this.flowSessions.slotOccupation?.[selectedSlot] || new Set();
      const availableResourceIds = allResourceIds.filter(
        (id) => !occupation.has(id),
      );

      if (availableResourceIds.length > 0) {
        const randomIndex = Math.floor(
          Math.random() * availableResourceIds.length,
        );
        selectedProfessionalId = availableResourceIds[randomIndex];

        // Recuperar nombre
        const foundResource = allResources.find(
          (r) => r.id === selectedProfessionalId,
        );
        if (foundResource) professionalDisplayName = foundResource.nombre;

        this.logger.log(
          `[DYN] Asignación abierta/Fallback. Recurso seleccionado: ${selectedProfessionalId}`,
        );
      } else {
        // Si no hay nadie libre, PERO el usuario había escogido a alguien específico y falló el match,
        // o si era 'Cualquiera' y todo está lleno.
        // INTENTO DE RECUPERACIÓN: Si no hay disponibles según el mapa,
        // asumimos que es un error de ocupación y forzamos al primero (o lanzamos error).

        // Opción segura: Loguear error pero permitir guardar como 'any_professional' para no perder la venta
        this.logger.error(
          '[DYN] Error: Slot marcado disponible pero sin recursos libres. Guardando como genérico.',
        );
        selectedProfessionalId = 'any_professional';
        professionalDisplayName = 'Equipo';
      }
    }
    // CASO B: No hay recursos configurados (Agenda General Simple)
    else if (!hasResources) {
      this.logger.log(
        `[DYN] Agenda General (Sin mapping). Guardando como 'any_professional'.`,
      );
      selectedProfessionalId = 'any_professional';
    }

    // --- 4. TÍTULO Y GUARDADO ---
    title = title.replace(/\$\{data\.(\w+)\}/g, (match, key) => {
      return newSessionData[key] ? String(newSessionData[key]) : match;
    });
    title = title.replace(/\$\{user\.phone\}/g, userNumber);

    if (
      selectedProfessionalId !== 'any_professional' &&
      professionalDisplayName
    ) {
      title += ` Profesional: ${professionalDisplayName}`;
    }

    const guestEmail = newSessionData.email ? [newSessionData.email] : [];
    const guestEmailString = guestEmail.length > 0 ? guestEmail[0] : null;

    try {
      const googleEvent: any = await this.calendarService.createEvent(
        numberId,
        date,
        time,
        title,
        duration,
        guestEmail,
      );

      const googleEventId = googleEvent?.id || 'unknown';

      await this.dynamoService.saveAppointment(
        numberId,
        selectedSlot,
        userNumber,
        title,
        duration,
        guestEmailString,
        googleEventId,
        selectedProfessionalId,
      );

      this.logger.log(
        `[DYN] Cita guardada correctamente. ID: ${selectedProfessionalId}`,
      );
    } catch (calendarError) {
      this.logger.error(
        `[DYN] ¡FALLO al crear cita en Google Calendar!`,
        calendarError,
      );
    }
  }

  /**
   * Determina la siguiente pantalla basándose en la lógica de navegación.
   */
  private _determineNextScreen(
    screen: string,
    data: any,
    flowNavigate: any,
    flowJson: any,
  ): string | null {
    // 1. Revisar si el usuario seleccionó una opción (ej. de RadioButtons)
    const dynamicKey = Object.keys(data).find(
      (key) =>
        typeof data[key] === 'string' &&
        (data[key].startsWith('opcion_') || data[key].startsWith('cat_opt_')),
    );

    if (dynamicKey) {
      const selectedOptionId = data[dynamicKey];
      if (flowNavigate && flowNavigate[selectedOptionId]) {
        const nextScreenId = flowNavigate[selectedOptionId].pantalla;
        this.logger.log(
          `[DYN] Navegación por Opción: ${screen} -> ${nextScreenId}`,
        );
        return nextScreenId;
      } else {
        this.logger.error(
          `[DYN] ¡ERROR! Opción '${selectedOptionId}' no encontrada en flowNavigate.`,
        );
        return null; // Termina el flujo
      }
    }

    // 2. Revisar si estamos en una pantalla especial (ej. 'appointmentNode'
    //    que necesita recargarse para mostrar horas).
    const currentScreenConfig =
      flowNavigate.__SCREEN_CONFIG__?.SCREENS?.[screen];
    if (
      currentScreenConfig &&
      currentScreenConfig.type === 'appointmentNode' &&
      data.appointment_date // (Esto es para un futuro flujo de 2 pasos)
    ) {
      this.logger.log(
        `[DYN] Navegación: Recargando ${screen} para mostrar horas.`,
      );
      return screen; // Se queda en la misma pantalla
    }

    // 3. Fallback: Usar el routing_model (para pantallas de Formulario)
    const nextScreenId = flowJson.routing_model[screen]?.[0];
    if (nextScreenId) {
      this.logger.log(
        `[DYN] Navegación por Fallback: ${screen} -> ${nextScreenId}`,
      );
      return nextScreenId;
    }

    return null; // No hay más pantallas
  }

  /**
   * Prepara el objeto de respuesta JSON para la siguiente pantalla,
   * incluyendo la carga de datos (si es necesario).
   */
  private async _prepareNextScreenResponse(
    nextScreenId: string,
    flowNavigate: any,
    flowJson: any,
    newSessionData: any,
    numberId: string,
    data: any,
    version: string,
  ): Promise<any> {
    let detailsData = {};
    let nextScreenData = {};

    const screenConfig =
      flowNavigate.__SCREEN_CONFIG__?.SCREENS?.[nextScreenId];

    // 1. Lógica del Data Source Trigger (ej. 'fetch_available_dates')
    if (screenConfig && screenConfig.dataSourceTrigger) {
      this.logger.log(
        `[DYN] Pantalla '${nextScreenId}' tiene un dataSourceTrigger: ${screenConfig.dataSourceTrigger}`,
      );
      nextScreenData = await this._handleDataSourceTrigger(
        screenConfig.dataSourceTrigger,
        screenConfig.config,
        numberId,
        data,
      );
    }

    // 2. Lógica para preparar 'details' (para pantallas de confirmación)
    if (screenConfig && screenConfig.type === 'confirmationNode') {
      this.logger.log(
        `[DYN] Generando datos 'details' para MOSTRAR en la pantalla ${nextScreenId}`,
      );
      const details = this._buildDynamicDetails(
        newSessionData,
        flowNavigate,
        flowJson,
      );
      detailsData = { details: details };
      this.logger.log(
        `[DYN] 'details' generados para mostrar: ${JSON.stringify(details)}`,
      );
    }

    return {
      version,
      screen: nextScreenId,
      data: { ...newSessionData, ...nextScreenData, ...detailsData },
    };
  }

  /**
   * Crea la respuesta JSON estándar para finalizar el flujo en Meta.
   */
  private _createSuccessResponse(flow_token: string): any {
    return {
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: {
            flow_token: flow_token || 'TEMPORARY_FLOW_TOKEN',
            summary_saved: true,
          },
        },
      },
    };
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  cleanupInactiveSessions(): void {
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    for (const [flowToken, session] of Object.entries(this.flowSessions)) {
      if (!session.timestamp) {
        delete this.flowSessions[flowToken];
        continue;
      }

      if (now - session.timestamp > ONE_HOUR_MS) {
        delete this.flowSessions[flowToken];
      }
    }
  }
}
