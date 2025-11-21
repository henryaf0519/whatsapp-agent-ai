/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { DynamoService } from '../../database/dynamo/dynamo.service';
import { SaveStagesDto } from '../dto/save-stages/save-stages';

@Injectable()
export class CrmService {
  constructor(private readonly dynamoService: DynamoService) {}

  async saveStages(numberId: string, saveStagesDto: SaveStagesDto) {
    return await this.dynamoService.saveCrmStages(
      numberId,
      saveStagesDto.stages,
    );
  }

  async getStages(numberId: string) {
    const stages = await this.dynamoService.getCrmStages(numberId);
    return { stages };
  }
}
