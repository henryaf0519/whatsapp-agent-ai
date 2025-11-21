/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CrmService } from './crm.service';
import { SaveStagesDto } from '../dto/save-stages/save-stages';
import { Request } from 'express';

@Controller('crm')
@UseGuards(AuthGuard('jwt')) // Protegemos con JWT como en los otros controladores
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Post('stages')
  @HttpCode(HttpStatus.OK)
  async saveStages(@Req() req: Request, @Body() saveStagesDto: SaveStagesDto) {
    // Extraemos el number_id del usuario logueado (definido en tu JwtStrategy)
    const user = req.user as { number_id: string };
    return this.crmService.saveStages(user.number_id, saveStagesDto);
  }

  @Get('stages')
  async getStages(@Req() req: Request) {
    const user = req.user as { number_id: string };
    return this.crmService.getStages(user.number_id);
  }
}
