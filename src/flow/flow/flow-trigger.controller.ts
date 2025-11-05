/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { FlowTriggerService } from './flow-trigger.service';

@UseGuards(AuthGuard('jwt')) // Protegemos todas las rutas del controlador
@Controller('flow-triggers')
export class FlowTriggerController {
  constructor(private readonly flowTriggerService: FlowTriggerService) {}

  // Helper para obtener el number_id del usuario autenticado
  private getNumberId(req: Request): string {
    const user = req.user as { number_id: string };
    if (!user || !user.number_id) {
      this.logErrorAndThrow('number_id no encontrado en el token del usuario.');
    }
    return user.number_id;
  }

  private logErrorAndThrow(message: string): never {
    // Podrías loggear el error aquí si quieres
    throw new HttpException(message, HttpStatus.UNAUTHORIZED);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: Record<string, any>) {
    const numberId = this.getNumberId(req);
    // Validación manual simple (ya que no usamos DTOs)
    if (!body.name || !body.flow_id || !body.screen_id || !body.flow_cta) {
      throw new HttpException(
        'Campos requeridos (name, flow_id, screen_id, flow_cta) faltantes.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.flowTriggerService.create(numberId, body);
  }

  @Get()
  async findAll(@Req() req: Request) {
    const numberId = this.getNumberId(req);
    return this.flowTriggerService.findAll(numberId);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') triggerId: string,
    @Body() body: Record<string, any>,
  ) {
    const numberId = this.getNumberId(req);
    if (Object.keys(body).length === 0) {
      throw new HttpException(
        'El cuerpo de la solicitud no puede estar vacío.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.flowTriggerService.update(numberId, triggerId, body);
  }
}
