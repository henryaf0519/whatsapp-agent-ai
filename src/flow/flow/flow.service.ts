/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private readonly privateKey: string;

  constructor(private readonly configService: ConfigService) {
    // Leemos la llave privada desde las variables de entorno
    const privateKey = this.configService.get<string>(
      'WHATSAPP_FLOW_PRIVATE_KEY',
    );
    if (!privateKey) {
      throw new Error(
        'WHATSAPP_FLOW_PRIVATE_KEY o META_APP_SECRET no están configuradas!',
      );
    }
    this.privateKey = privateKey;
  }

  processFlowData(body: any): Promise<string> {
    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } =
      this.decryptRequest(body, this.privateKey);

    this.logger.log(
      `[PRUEBA] Datos descifrados: ${JSON.stringify(decryptedBody)}`,
    );

    // --- LÓGICA DE TU NEGOCIO (PARA LA PRUEBA) ---
    // Aquí puedes definir qué pantalla enviar a continuación.
    // Por ahora, solo devolveremos una pantalla de ejemplo llamada "SCREEN_NAME".
    const nextScreenData = {
      version: decryptedBody.version,
      screen: 'SCREEN_NAME', // Asegúrate de que tu Flow JSON tenga una pantalla con este nombre
      data: {
        message: '¡El endpoint funciona y los datos fueron descifrados!',
        // Puedes añadir más datos aquí para mostrarlos en la pantalla
        // received_action: decryptedBody.action,
      },
    };

    // --- CIFRADO DE LA RESPUESTA ---
    return Promise.resolve(
      this.encryptResponse(nextScreenData, aesKeyBuffer, initialVectorBuffer),
    );
  }

  // --- MÉTODOS DE CRIPTOGRAFÍA (Directamente del ejemplo de Meta) ---

  private decryptRequest(
    body: any,
    privatePem: string,
  ): { aesKeyBuffer: Buffer; initialVectorBuffer: Buffer; decryptedBody: any } {
    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

    const decryptedAesKey = crypto.privateDecrypt(
      {
        key: crypto.createPrivateKey(privatePem),
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
}
