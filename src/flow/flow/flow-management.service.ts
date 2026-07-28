import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

@Injectable()
export class FlowManagementService {
  private readonly logger = new Logger(FlowManagementService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';
  private readonly urlWebhook: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly dynamoService: DynamoService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {
    this.urlWebhook = this.configService.get<string>('URL_FLOW_WEBHOOK');
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

  async getFlowById(flowId: string, numberId: string) {
    const token = await this.whatsappService.getWhatsappToken(numberId);
    let flowJsonContent: any = null;
    let flowN: any = null;

    try {
      const flowJson = await this.getFlowJsonContentHelper(flowId, token);
      flowJsonContent = flowJson;
      flowN = await this.dynamoService.getClientFlowDefinition(
        numberId,
        flowId,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo obtener el flow.json para ${flowId} (puede ser un flow vacío). Error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return {
      flow_json: flowJsonContent,
      navigation: JSON.parse(flowN?.navigation) || null,
    };
  }

  private async getFlowJsonContentHelper(flowId: string, token: string): Promise<any> {
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

  async getFlows(wabaId: string, numberId: string) {
    const token = await this.whatsappService.getWhatsappToken(numberId);
    const url = `${this.baseUrl}/${wabaId}/flows`;

    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Error al obtener flows para WABA ID: ${wabaId}`, error);
      this.throwMetaError(error, 'Error al obtener la lista de flows');
    }
  }

  async updateFlowAssets(flowId: string, numberId: string, flowJson: string, navigation: string) {
    this.logger.log(`Actualizando assets (flow.json) para el Flow ID: ${flowId}, Cliente: ${numberId}`);
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
        this.logger.log(` Flujo ${flowId} guardado en DynamoDB exitosamente!`);
      } catch (dynamoError) {
        this.logger.error(
          ` INCONSISTENCIA! El flujo ${flowId} se actualizó en Meta, pero falló al guardar en DynamoDB.`,
          dynamoError,
        );
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
        error?.response?.data || error?.message,
      );
      this.throwMetaError(error, 'Error al actualizar el flow');
    }
  }

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
      this.logger.error(`Error al asignar Endpoint URI para flow: ${flowId}`, error);
      this.throwMetaError(error, 'Error al asignar el Endpoint URI');
    }

    this.logger.log(`Intentando publicar el flow...`);
    const publishUrl = `${this.baseUrl}/${flowId}/publish`;

    try {
      const response = await axios.post(publishUrl, null, {
        headers: { Authorization: `Bearer ${token}` },
      });
      this.logger.log(`Flow ${flowId} publicado exitosamente.`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error al publicar flow: ${flowId}`, error);
      this.throwMetaError(error, 'Error al publicar el flow (después de asignar el URI)');
    }
  }

  async sendTestFlow(flowId: string, flowName: string, to: string, screen: string, number_id: string) {
    this.logger.log(`Iniciando envío de prueba para flow ${flowId} a ${to}`);
    if (!to || !number_id || !flowId || !screen || !flowName) {
      throw new NotFoundException('Faltan datos en el payload (to, number_id, flowId, screen, o flowName)');
    }

    const token = await this.whatsappService.getWhatsappToken(number_id);
    if (!token) {
      throw new NotFoundException(`No se encontró token para number_id: ${number_id}`);
    }

    try {
      this.logger.log(`Paso 1/2: Verificando Endpoint URI...`);
      await this.updateFlowEndpointUri(flowId, flowName, token);
      this.logger.log(`Paso 1/2: Endpoint URI verificado.`);
    } catch (error) {
      this.logger.error(`Error al publicar flow: ${flowId}`, error);
      this.throwMetaError(error, 'Error al publicar el flow (después de asignar el URI)');
    }

    const flowToken = `nombre_${to}_${number_id}_${flowId}_${Date.now()}`;
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
            flow_action_payload: { screen: screen },
          },
        },
      },
    };

    this.logger.log(`Enviando payload de prueba a Graph API: ${JSON.stringify(payload)}`);
    await this.whatsappService.sendFlowDraft(to, number_id, token, payload);
    return { success: true, message: `Prueba enviada a ${to}` };
  }

  async updateFlowEndpointUri(flowId: string, flowName: string, token: string) {
    this.logger.log(`Actualizando Endpoint URI para Flow ID: ${flowId}`);
    const metadataUrl = `${this.baseUrl}/${flowId}`;
    const form = new FormData();
    form.append('name', flowName);
    form.append('categories', '["OTHER"]');
    form.append('endpoint_uri', this.urlWebhook || '');

    try {
      await axios.post(metadataUrl, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      });
      this.logger.log(`Endpoint URI asignado exitosamente para ${flowId}.`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error al asignar Endpoint URI para flow: ${flowId}`, error);
      this.throwMetaError(error, 'Error al asignar el Endpoint URI');
    }
  }

  private throwMetaError(error: any, defaultMessage: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error;
      const errorMessage = axiosError.response?.data?.error?.message || defaultMessage;
      const errorStatus = axiosError.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
      
      this.logger.error(`Error de la API de Meta [${errorStatus}]: ${errorMessage}`);
      this.logger.debug(`Respuesta completa del error: ${JSON.stringify(axiosError.response?.data)}`);
      
      throw new HttpException(
        {
          message: `Error de la API de Meta: ${errorMessage}`,
          metaError: axiosError.response?.data?.error,
        },
        errorStatus,
      );
    }
    
    this.logger.error(`Error inesperado no relacionado con Axios: ${error.message}`);
    throw new HttpException(defaultMessage, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}