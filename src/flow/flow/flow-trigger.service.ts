/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { DynamoService } from 'src/database/dynamo/dynamo.service';

@Injectable()
export class FlowTriggerService {
  constructor(private readonly dynamoService: DynamoService) {}

  async create(numberId: string, body: Record<string, any>) {
    const {
      name,
      flow_id,
      flow_cta,
      screen_id,
      header_text,
      body_text,
      footer_text,
      initial_data,
    } = body;

    const triggerData = {
      name,
      flow_id,
      flow_cta,
      screen_id,
      header_text,
      body_text,
      footer_text: footer_text || null, // Manejamos el opcional
      initial_data: initial_data || {},
    };

    return this.dynamoService.createFlowTrigger(numberId, triggerData);
  }

  async findAll(numberId: string) {
    return this.dynamoService.getFlowTriggersForBusiness(numberId);
  }

  async update(numberId: string, triggerId: string, body: Record<string, any>) {
    // El body solo contiene los campos a actualizar
    return this.dynamoService.updateFlowTrigger(numberId, triggerId, body);
  }
}
