import { Controller, Body, Post, Get } from '@nestjs/common';
import { DynamoService } from './dynamo.service';

@Controller('dynamo')
export class DynamoController {
  constructor(private readonly dynamoService: DynamoService) {}

  @Post()
  async createItem(@Body() payload: Record<string, any>) {
    return this.dynamoService.guardarDato(payload);
  }

  @Get()
  async getHuecos(@Body() payload: Record<string, any>) {
    return this.dynamoService.obtenerHuecosDisponibles(
      payload.name,
      payload.fecha,
    );
  }
}
