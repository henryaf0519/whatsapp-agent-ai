/* eslint-disable @typescript-eslint/no-unsafe-return */
// src/bulk-messaging/bulk-messaging.controller.ts
import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { BulkMessagingService } from './bulk-messaging.service';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { SendImmediateDto } from '../dto/send-immediate.dto';

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

  /**
   * Endpoint para enviar una plantilla inmediatamente sin pasar por el cron.
   * Corresponde al comando curl a /bulk-messaging/send-immediate
   */
  @Post('send-immediate')
  sendImmediate(@Body() sendImmediateDto: SendImmediateDto) {
    return this.bulkMessagingService.sendImmediate(sendImmediateDto);
  }
}
