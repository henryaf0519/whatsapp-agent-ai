// src/bulk-messaging/bulk-messaging.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { BulkMessagingService } from './bulk-messaging.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('bulk-messaging')
//@UseGuards(AuthGuard('jwt')) // Protege todas las rutas de este controlador
export class BulkMessagingController {
  constructor(private readonly bulkMessagingService: BulkMessagingService) {}

  /**
   * Endpoint para crear una nueva programación de mensajes masivos.
   * Corresponde al comando curl con POST.
   */
  @Post('schedule')
  async createSchedule(@Body() createScheduleDto: CreateScheduleDto) {
    return this.bulkMessagingService.createSchedule(createScheduleDto);
  }

  /**
   * Endpoint para obtener todas las programaciones existentes.
   * Corresponde al comando curl con GET.
   */
  @Get('schedules')
  async getSchedules() {
    return this.bulkMessagingService.getAllSchedules();
  }

  /**
   * Endpoint para eliminar una programación específica por su ID.
   * Corresponde al comando curl con DELETE.
   */
  @Delete('schedule/:scheduleId')
  async deleteSchedule(@Param('scheduleId') scheduleId: string) {
    return this.bulkMessagingService.deleteSchedule(scheduleId);
  }
}
