/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private readonly privateKey: string;

  constructor(private readonly configService: ConfigService) {
    const privateKey = this.configService.get<string>(
      'WHATSAPP_FLOW_PRIVATE_KEY',
    );
    if (!privateKey) {
      throw new Error('WHATSAPP_FLOW_PRIVATE_KEY no está configurada!');
    }
    this.privateKey = privateKey;
  }

  processFlowData(body: any): Promise<string> {
    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } =
      this.decryptRequest(body, this.privateKey);

    this.logger.log(
      `[ÉXITO] Datos descifrados: ${JSON.stringify(decryptedBody)}`,
    );

    let responseData;
    const { version, action, screen, data } = decryptedBody;

    switch (action) {
      // ... (casos 'ping' e 'init' se quedan igual)
      case 'ping':
        this.logger.log('Respondiendo al "ping" de la comprobación de estado.');
        responseData = { data: { status: 'active' } };
        break;

      case 'init':
        this.logger.log(
          'Acción "init" recibida. Enviando pantalla de bienvenida.',
        );
        responseData = {
          version,
          screen: 'WELCOME',
          data: {
            selection: [
              { id: 'ABOUT_US', title: 'Quienes Somos' },
              { id: 'PRODUCTS', title: 'Precios Seguridad Social' },
            ],
          },
        };
        break;

      case 'data_exchange':
        this.logger.log(
          `Acción "data_exchange" recibida desde la pantalla: ${screen}`,
        );

        if (screen === 'WELCOME') {
          this.logger.log(
            `Objeto 'data' completo recibido: ${JSON.stringify(data)}`,
          );
          const nextScreen = data.selection;
          this.logger.log(
            `Navegando a la pantalla seleccionada: ${nextScreen}`,
          );

          let screenData = {};

          // --- INICIO DE LA MODIFICACIÓN ---
          if (nextScreen === 'PRODUCTS') {
            // Ahora enviamos TODOS los datos que la pantalla de productos necesita para ser interactiva
            screenData = {
              independent_options_visibility: false,
              dependent_options_visibility: false,
              //dependent produts
              dependent_h: false,
              dependent_hr: false,
              dependent_hrp: false,
              dependent_hrb: false,
              dependent_hrpb: false,
              independent_hr: false,
              independent_hrp: false,
              economic_activity: [
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
              ],
              independent_options: [
                {
                  id: 'indep_opc1',
                  title: 'Salud, Riesgo (Pensionados)',
                  'on-select-action': {
                    name: 'update_data',
                    payload: {
                      independent_hr: true,
                      independent_hrp: false,
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
                    },
                  },
                },
              ],
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
              dependent_options: [
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
          }
          // --- FIN DE LA MODIFICACIÓN ---

          responseData = {
            version,
            screen: nextScreen,
            data: screenData,
          };
        } else if (screen === 'PRODUCTS') {
          // ... resto de la lógica sin cambios
          responseData = {
            version,
            screen: 'FINISH_FORM',
            data: {},
          };
        } else if (screen === 'FINISH_FORM') {
          const formData = data;
          this.logger.log('Datos del formulario recibidos:', formData);

          responseData = {
            version,
            screen: 'CONFIRM',
            data: {
              /* ... datos de confirmación ... */
            },
          };
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

    // Formatea la clave para asegurar que sea correcta, sin importar cómo esté en .env
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

    // El resto del descifrado sigue igual...
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
}
