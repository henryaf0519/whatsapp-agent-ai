/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable no-case-declarations */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { SocketGateway } from 'src/socket/socket.gateway';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { QuotationService } from 'src/quotation/quotation.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FlowCryptoService } from './flow-crypto.service';
import { FlowAppointmentService } from './flow-appointment.service';
import { FlowQuotationMapperService } from './flow-quotation-mapper.service';

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private flowSessions: Record<string, any> = {};

  constructor(
    private readonly dynamoService: DynamoService,
    private readonly socketGateway: SocketGateway,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly quotationService: QuotationService,
    private readonly cryptoService: FlowCryptoService,
    private readonly appointmentService: FlowAppointmentService,
    private readonly quotationMapper: FlowQuotationMapperService,
  ) {}

  async processDynamicFlowData(body: any): Promise<string> {
    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } = this.cryptoService.decryptRequest(body);
    this.logger.log(`[DYN] Datos descifrados: ${JSON.stringify(decryptedBody)}`);

    const { version, action, screen, data, flow_token } = decryptedBody;

    if (action === 'ping') {
      this.logger.log('Respondiendo al "ping" de la comprobación de estado.');
      const responseData = { data: { status: 'active' } };
      return this.cryptoService.encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
    }

    const { numberId, userNumber, flow_id, userName } = this._parseFlowToken(flow_token);

    if (!flow_id || !numberId || !userNumber) {
      throw new Error('No se pudo parsear flow_token o falta flow_id');
    }

    const fullFlowData = await this._getFlowJson(numberId, flow_id);
    const { flowJson, flowNavigate } = fullFlowData;

    if (!flowJson || !flowNavigate) {
      throw new Error('Estructura de JSON de flujo inválida');
    }

    const currentSessionData = this.flowSessions[flow_token]?.data || {};
    currentSessionData.userName = userName;
    const newSessionData = { ...currentSessionData, ...data };
    this.flowSessions[flow_token] = { timestamp: Date.now(), data: newSessionData };

    let responseData: any;

    switch (action) {
      case 'INIT': {
        this.logger.log(`[DYN] Acción INIT para ${flow_id}`);
        this.flowSessions[flow_token] = { timestamp: Date.now(), data: {} };
        const startScreenId = Object.keys(flowJson.routing_model)[0];
        responseData = { version, screen: startScreenId, data: {} };
        break;
      }
      case 'data_exchange': {
        if (data && data.flow_completed === 'true') {
          this.logger.log(`[DYN] ¡Flujo finalizado por el usuario en la pantalla ${screen}!`);
          await this._executeFlowCompletionLogic(newSessionData, flowNavigate, flowJson, numberId, userNumber, flow_token, screen);
          responseData = this._createSuccessResponse(data.flow_token);
        } else {
          const nextScreenId = this._determineNextScreen(screen, data, flowNavigate, flowJson);
          if (nextScreenId) {
            responseData = await this._prepareNextScreenResponse(nextScreenId, flowNavigate, flowJson, newSessionData, numberId, data, version);
          } else {
            this.logger.log(`[DYN] Pantalla terminal '${screen}' alcanzada. Enviando respuesta de finalización.`);
            responseData = this._createSuccessResponse(data.flow_token);
          }
        }
        break;
      }
      case 'complete': {
        this.logger.log(`[DYN] Acción 'complete' recibida desde: ${screen}`);
        await this._executeFlowCompletionLogic(newSessionData, flowNavigate, flowJson, numberId, userNumber, flow_token, screen);
        delete this.flowSessions[flow_token];
        responseData = { version, data: { success: true } };
        break;
      }
      default:
        this.logger.warn(`Acción no reconocida recibida: ${action}`);
        throw new Error(`Acción no soportada: ${action}`);
    }

    return this.cryptoService.encryptResponse(responseData, aesKeyBuffer, initialVectorBuffer);
  }

  private _parseFlowToken(flow_token: string) {
    try {
      const parts = flow_token.split('_');
      return { userName: parts[0], userNumber: parts[1], numberId: parts[2], flow_id: parts[3] };
    } catch (error) {
      throw new Error('flow_token inválido');
    }
  }

  private async _getFlowJson(numberId: string, flowId: string): Promise<any> {
    const definitionItem = await this.dynamoService.getClientFlowDefinition(numberId, flowId);
    if (!definitionItem || !definitionItem.flow_definition) {
      throw new NotFoundException('Definición de flujo no encontrada.');
    }
    return {
      flowJson: JSON.parse(definitionItem.flow_definition),
      flowNavigate: JSON.parse(definitionItem.navigation),
    };
  }

  private _buildDynamicDetails(newSessionData: any, flowNavigate: any, flowJson: any, title?: string): string {
    const details: string[] = [];
    if (title) details.push(title);
    else details.push('📋 Resumen de tu solicitud:');

    const processedFields = new Set<string>();

    for (const screen of flowJson.screens) {
      const form = screen.layout?.children?.find((child: any) => child.type === 'Form');
      if (!form || !form.children) continue;

      for (const field of form.children) {
        const fieldName = field.name;
        if (!fieldName || processedFields.has(fieldName)) continue;

        const value = newSessionData[fieldName];
        if (!value) continue;

        let formattedKey = '';
        if (fieldName === 'date') formattedKey = 'Cita seleccionada';
        else if (fieldName === 'selected_plan' || fieldName === 'plan') formattedKey = 'Plan Seleccionado';
        else if (field.label) formattedKey = field.label.replace(':', '');
        else formattedKey = fieldName.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

        let readableValue = String(value);
        if (readableValue.startsWith('opcion_') || readableValue.startsWith('cat_opt_')) {
          if (flowNavigate[readableValue] && flowNavigate[readableValue].valor) {
            readableValue = flowNavigate[readableValue].valor;
          } else continue;
        }

        if (formattedKey.trim().toLowerCase() === 'selecciona') continue;
        details.push(`${formattedKey}: ${readableValue}`);
        processedFields.add(fieldName);
      }
    }
    if (processedFields.size === 0) details.push('Tu solicitud ha sido registrada.', 'Un agente se comunicará contigo.');
    return details.join('\n');
  }

  private async saveMessage(businessId: string, userNumber: string, details: any) {
    await this.dynamoService.saveMessage(businessId, userNumber, userNumber, details || '', '', 'RECEIVED', 'respflow', '');
    const sendSocketUser = { from: userNumber, text: details || '', type: 'respflow', url: '', SK: `MESSAGE#${new Date().toISOString()}` };
    this.socketGateway.sendNewMessageNotification(businessId, userNumber, sendSocketUser);
  }

  private async _handleDataSourceTrigger(trigger: string, config: any, numberId: string, data: any, newSessionData: any): Promise<Record<string, any>> {
    switch (trigger) {
      case 'fetch_available_dates':
        let selectedProfessionalId = 'any_professional';
        let rawOptionFound = '';
        const resourceMapping = config.resourceMapping || {};
        const allDataValues = Object.values(this.flowSessions[data.flow_token]?.data || {});

        for (const val of allDataValues) {
          if (typeof val === 'string' && resourceMapping[val.trim()]) {
            selectedProfessionalId = resourceMapping[val.trim()].id;
            rawOptionFound = val.trim();
            break;
          }
        }
        
        if (selectedProfessionalId === 'any_professional') {
          for (const val of Object.values(data)) {
            if (typeof val === 'string' && resourceMapping[val.trim()]) {
              selectedProfessionalId = resourceMapping[val.trim()].id;
              rawOptionFound = val.trim();
              break;
            }
          }
        }

        const dates = await this.appointmentService.generateAvailableDates(config, numberId, selectedProfessionalId, resourceMapping, this.flowSessions);
        return { date: dates };

      case 'execute_backend_service':
        const result = await this.quotationMapper.processQuotation(newSessionData, numberId);
        return { details: result };

      default:
        this.logger.warn(`[DYN] dataSourceTrigger no reconocido: ${trigger}`);
        return {};
    }
  }

  private async _executeFlowCompletionLogic(newSessionData: any, flowNavigate: any, flowJson: any, numberId: string, userNumber: string, flow_token: string, screen: string): Promise<void> {
    try {
      const screenConfig = flowNavigate.__SCREEN_CONFIG__?.SCREENS?.[screen];
      
      if (screenConfig?.postFlowAction?.type === 'send_whatsapp_link') {
        const { wpMessage, wpUrl } = screenConfig.postFlowAction;
        try {
          await this.whatsappService.sendMessageLink(userNumber, numberId, `${wpMessage} ${wpUrl}`);
        } catch (linkError) {
          this.logger.error(`[DYN] Error al enviar mensaje con enlace a ${userNumber}`, linkError);
        }
      }

      const fullQuotationResponse = newSessionData.fullQuotationResponse;
      const rawSelectedPlan = newSessionData['selected_plan'];

      if (fullQuotationResponse && rawSelectedPlan) {
        const plansArray = fullQuotationResponse.plans || [];
        let selectedPlanId: any = null;

        if (plansArray.length > 0) {
          const normalizeText = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace("plan ", "").trim();
          const normalizedSelection = normalizeText(rawSelectedPlan);
          for (const plan of plansArray) {
            if (normalizeText(plan.planName || plan.name || '') === normalizedSelection) {
              selectedPlanId = plan.planId !== undefined ? plan.planId : plan.id;
              break;
            }
          }
          if (selectedPlanId !== null) {
            await this.quotationService.selectPlan({ ...fullQuotationResponse, selectedPlanId });
          }
        }
      } else {
        await this.appointmentService.createCalendarEvent(newSessionData, flowNavigate, numberId, userNumber, this.flowSessions);
      }

      const details = this._buildDynamicDetails(newSessionData, flowNavigate, flowJson);
      await this.saveMessage(numberId, userNumber, details);
      
      delete this.flowSessions[flow_token];
    } catch (e) {
      delete this.flowSessions[flow_token];
      this.logger.error(`[DYN] Error durante la ejecución de fin de flujo: ${e}`);
    }
  }

  private _determineNextScreen(screen: string, data: any, flowNavigate: any, flowJson: any): string | null {
    const dynamicKey = Object.keys(data).find(
      (key) => typeof data[key] === 'string' && (data[key].startsWith('opcion_') || data[key].startsWith('cat_opt_'))
    );

    if (dynamicKey) {
      const selectedOptionId = data[dynamicKey];
      return flowNavigate?.[selectedOptionId]?.pantalla || null;
    }

    const currentScreenConfig = flowNavigate.__SCREEN_CONFIG__?.SCREENS?.[screen];
    if (currentScreenConfig?.type === 'appointmentNode' && data.appointment_date) {
      return screen;
    }

    return flowJson.routing_model[screen]?.[0] || null;
  }

  private async _prepareNextScreenResponse(nextScreenId: string, flowNavigate: any, flowJson: any, newSessionData: any, numberId: string, data: any, version: string): Promise<any> {
    let detailsData = {};
    let nextScreenData = {};
    const screenConfig = flowNavigate.__SCREEN_CONFIG__?.SCREENS?.[nextScreenId];

    if (screenConfig?.dataSourceTrigger) {
      nextScreenData = await this._handleDataSourceTrigger(screenConfig.dataSourceTrigger, screenConfig.config, numberId, data, newSessionData);
    }

    if (screenConfig?.type === 'confirmationNode') {
      detailsData = { details: this._buildDynamicDetails(newSessionData, flowNavigate, flowJson) };
    }

    return {
      version,
      screen: nextScreenId,
      data: { ...newSessionData, ...nextScreenData, ...detailsData },
    };
  }

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
      if (!session.timestamp || now - session.timestamp > ONE_HOUR_MS) {
        delete this.flowSessions[flowToken];
      }
    }
  }
}