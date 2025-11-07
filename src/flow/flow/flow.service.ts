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
          this.saveMessage(businessId, userNumber, responseData);

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

          this.saveMessage(businessId, userNumber, responseData);
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
            this.saveMessage(businessId, userNumber, responseData);
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
          this.saveMessage(businessId, userNumber, responseData);
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
          this.saveMessage(businessId, userNumber, responseData);
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

    const flowJson = await this._getFlowJson(numberId, flow_id);
    let responseData: any;

    // 3. Obtener y fusionar datos de sesión
    const currentSessionData = this.flowSessions[flow_token] || {};
    const newSessionData = { ...currentSessionData, ...data };
    this.flowSessions[flow_token] = newSessionData; // Guardar estado actualizado

    // 4. Enrutar la acción (INIT, data_exchange, o complete)
    switch (action) {
      case 'INIT': {
        this.logger.log(`[DYN] Acción INIT para ${flow_id}`);
        // Limpiamos sesión anterior
        this.flowSessions[flow_token] = {};

        // La pantalla de inicio es la primera clave en routing_model
        const startScreenId = Object.keys(flowJson.routing_model)[0];
        if (!startScreenId) {
          throw new NotFoundException(
            'No se encontró una pantalla de inicio en routing_model',
          );
        }

        responseData = {
          version,
          screen: startScreenId,
          data: {}, // La pantalla de inicio (ej. BIENVENIDA) no necesita datos iniciales
        };
        break;
      }

      case 'data_exchange': {
        this.logger.log(`[DYN] Acción data_exchange desde pantalla: ${screen}`);
        this.logger.log(`[DYN] Datos recibidos: ${JSON.stringify(data)}`);
        let nextScreenId: string;

        // 1. Determinar la siguiente pantalla (Lógica de Navegación Dinámica)
        if (data && data.selection) {
          // Caso 1: Es un ScreenNode (Menú)
          // El frontend nos envía el ID de la pantalla de destino.
          nextScreenId = data.selection; // Ej: "DATOS"
          this.logger.log(
            `[DYN] Navegando por data.selection: ${nextScreenId}`,
          );
        } else if (data && data.catalog_selection) {
          // Caso 2: Es un CatalogNode
          nextScreenId = data.catalog_selection;
          this.logger.log(
            `[DYN] Navegando por data.catalog_selection: ${nextScreenId}`,
          );
        } else {
          // Caso 3: Fallback (Ej: un FormNode que solo captura datos)
          // Usa el routing_model para encontrar el (único) siguiente paso.
          // Esta es la lógica que tenías antes.
          nextScreenId = flowJson.routing_model[screen]?.[0];
          this.logger.log(
            `[DYN] Navegando por routing_model (fallback): ${nextScreenId}`,
          );
        }

        // --- FIN DE LA MODIFICACIÓN ---

        this.logger.log(
          `[DYN] Siguiente pantalla seleccionada: ${nextScreenId}`,
        );

        if (!nextScreenId) {
          // Modifiqué el error para incluir los datos y facilitar el debug
          throw new NotFoundException(
            `No se encontró ruta de navegación para la pantalla "${screen}" (datos: ${JSON.stringify(data)}) en routing_model`,
          );
        }

        let nextScreenData = {};

        // Verificamos si la *siguiente* pantalla (ej. CONFIRMACION) espera datos
        const nextScreenDef = flowJson.screens.find(
          (s) => s.id === nextScreenId,
        );

        // Esta lógica para generar los 'details' es correcta y no la he tocado.
        if (nextScreenDef && nextScreenDef.data) {
          if (
            Object.prototype.hasOwnProperty.call(nextScreenDef.data, 'details')
          ) {
            this.logger.log(
              `[DYN] Generando datos 'details' para la pantalla ${nextScreenId}`,
            );
            const details = this._buildDynamicDetails(newSessionData);
            await this.saveMessage(numberId, userNumber, details);
            this.logger.log(
              `[DYN] Resumen generado: ${JSON.stringify(details)}`,
            );
            nextScreenData = { details: details };
          }
        }

        // Preparamos la respuesta para Meta usando el ID de pantalla dinámico
        responseData = {
          version,
          screen: nextScreenId, // <--- Aquí se usa el ID dinámico
          data: nextScreenData,
        };
        break;
      }

      case 'complete': {
        this.logger.log(`[DYN] Acción 'complete' recibida desde: ${screen}`);

        // Esta es la acción final (ej. desde la pantalla CONFIRMACION)
        const finalData = this.flowSessions[flow_token];
        this.logger.log(
          `[DYN] Flujo ${flow_id} completado. Datos finales: ${JSON.stringify(finalData)}`,
        );

        // Construir un resumen final 100% dinámico
        const summary = this._buildDynamicDetails(
          finalData,
          'Cliente finalizó el flujo',
        );

        // Guardar el resumen final en DynamoDB y notificar al dashboard
        await this.saveMessage(numberId, userNumber, summary);

        // Limpiar la sesión
        delete this.flowSessions[flow_token];

        // Enviar respuesta de éxito
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
      this.logger.log(`[DYN] Parseando flow_token: ${flow_token}`);
      // Asumiendo formato: token_${to}_${businessId}_${Date.now()}
      const parts = flow_token.split('_');
      this.logger.log(`[DYN] Partes del token: ${JSON.stringify(parts)}`);
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
      return JSON.parse(definitionItem.flow_definition);
    } catch (error) {
      this.logger.error(
        `[DYN] Error parseando JSON para flowId: ${flowId}`,
        error,
      );
      throw new Error('Error al parsear la definición del flujo.');
    }
  }

  /**
   * Construye un string de detalles 100% dinámico basado en los datos de la sesión.
   * No asume nombres de campos como 'nombre' o 'email'.
   */
  private _buildDynamicDetails(sessionData: any, title?: string): string {
    const details: string[] = [];

    if (title) {
      details.push(title);
      details.push('-----------------');
    }

    for (const key in sessionData) {
      if (Object.prototype.hasOwnProperty.call(sessionData, key)) {
        const value = sessionData[key];
        // Capitalizar la primera letra de la clave para que se vea bien
        const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
        details.push(`${formattedKey}: ${value || 'No especificado'}`);
      }
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
    responseData: any,
  ) {
    await this.dynamoService.saveMessage(
      businessId,
      userNumber,
      userNumber,
      responseData.data.details || '',
      '',
      'RECEIVED',
      'respflow',
      '',
    );
    const sendSocketUser = {
      from: userNumber,
      text: responseData.data.details || '',
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
    this.logger.log(`Creando Flow "${name}" para WABA ID: ${wabaId}`);
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
    this.logger.log(`Obteniendo Flow (metadata y JSON) con ID: ${flowId}`);
    const token = await this.whatsappService.getWhatsappToken(numberId);
    let flowJsonContent: any = null; // Default a null si no se encuentra
    try {
      // Usamos el token que ya teníamos para llamar a nuestra nueva función helper
      const flowJson = await this.getFlowJsonContentHelper(flowId, token);
      flowJsonContent = flowJson;
    } catch (error) {
      // Es normal que falle si el flow está en DRAFT y nunca se le ha subido un JSON
      this.logger.warn(
        `No se pudo obtener el flow.json para ${flowId} (puede ser un flow vacío). Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // No relanzamos el error, solo dejamos el JSON como null
    }

    // --- PASO 3: Combinar y retornar ---
    return {
      flow_json: flowJsonContent, // Añadimos el JSON (o null) a la respuesta
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
    this.logger.log(`Obteniendo todos los flows para WABA ID: ${wabaId}`);
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
  async updateFlowAssets(flowId: string, numberId: string, flowJson: string) {
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

      this.logger.log(
        `ÉxITO en Meta API. Respuesta: ${JSON.stringify(response.data)}`,
      );
      try {
        this.logger.log(
          `Guardando definición de flujo en DynamoDB para ${numberId}/${flowId}...`,
        );

        await this.dynamoService.saveClientFlowDefinition(
          numberId,
          flowId,
          flowJson,
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
}
