/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { SocketGateway } from 'src/socket/socket.gateway';

const WELCOME_OPTIONS = [
  { id: 'ABOUT_US', title: 'Quienes Somos' },
  { id: 'PRODUCTS', title: 'Precios Seguridad Social' },
  { id: 'POLICIES', title: 'Polizas de Incapacidad' },
  { id: 'MONTHLY', title: 'Pagar Mensualidad' },
  { id: 'EXTERIOR', title: 'No pensionados en el exterior' },
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
      payload: { independent_hr: true, independent_hrp: false },
    },
  },
  {
    id: 'indep_opc2',
    title: 'Salud, Riesgo y Pensión',
    'on-select-action': {
      name: 'update_data',
      payload: { independent_hr: false, independent_hrp: true },
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
  ...ECONOMIC_ACTIVITY,
  ...INDEPENDENT_OPTIONS,
  ...DEPENDENT_OPTIONS,
  ...POLICIES_OPTIONS, // NUEVO: Añadido para la traducción
  ...Object.values(ALL_PRICE_OPTIONS).flat(),
];

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private readonly privateKey: string;
  private flowSessions: Record<string, any> = {};

  constructor(
    private readonly configService: ConfigService,
    private readonly dynamoService: DynamoService,
    private readonly socketGateway: SocketGateway,
  ) {
    const privateKey = this.configService.get<string>(
      'WHATSAPP_FLOW_PRIVATE_KEY',
    );
    if (!privateKey) {
      throw new Error('WHATSAPP_FLOW_PRIVATE_KEY no está configurada!');
    }
    this.privateKey = privateKey;
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

  private decryptRequest(
    body: any,
    privatePem: string,
  ): { aesKeyBuffer: Buffer; initialVectorBuffer: Buffer; decryptedBody: any } {
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
}
