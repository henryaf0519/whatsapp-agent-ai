import { Injectable, Logger } from '@nestjs/common';
import { DynamoService } from 'src/database/dynamo/dynamo.service';
import { CalendarService } from 'src/calendar/calendar.service';
import moment from 'moment';

@Injectable()
export class FlowAppointmentService {
  private readonly logger = new Logger(FlowAppointmentService.name);

  constructor(
    private readonly dynamoService: DynamoService,
    private readonly calendarService: CalendarService,
  ) {}

  async generateAvailableDates(
    config: any,
    numberId: string,
    selectedProfessionalId: string = 'any_professional',
    resourceMapping: Record<string, any> = {},
    sessionState: Record<string, any> // Pasamos las sesiones para manejar el slotOccupation
  ): Promise<{ id: string; title: string }[]> {
    const { daysToShow, daysAvailable, startTime, endTime, intervalMinutes, breakTimes } = config;
    const availableSlots: { id: string; title: string }[] = [];
    const timeZone = 'America/Bogota';
    const minimumSlotTime = moment.tz(timeZone).add(2, 'hours');

    const allResources = Object.values(resourceMapping) as any[];
    const allResourceIds = allResources.map((r) => r.id).filter((id) => id !== 'any_professional');
    const maxCapacity = allResourceIds.length > 0 ? new Set(allResourceIds).size : 1;

    const queryStartDate = minimumSlotTime.format('YYYY-MM-DD HH:mm');
    const queryEndDate = moment.tz(timeZone).add(30, 'days').endOf('day').format('YYYY-MM-DD HH:mm');

    const rawAppointments = await this.dynamoService.getAppointmentsForRange(numberId, queryStartDate, queryEndDate);
    const busySlots = new Set<string>();
    const slotOccupationMap: Record<string, Set<string>> = {};

    const appointmentsArray = Array.from(rawAppointments);
    appointmentsArray.forEach((appt: any) => {
      let slotTimeStr = '';
      let apptProfId = 'any_professional';

      if (appt && appt.SK && typeof appt.SK === 'string') {
        const parts = appt.SK.split('#');
        if (parts.length >= 2) slotTimeStr = parts[1];
        if (parts.length > 2) {
          apptProfId = parts[2];
        } else {
          apptProfId = appt.professionalId || 'any_professional';
        }
      }
      if (!slotTimeStr) return;

      if (selectedProfessionalId !== 'any_professional') {
        if (apptProfId === selectedProfessionalId) busySlots.add(slotTimeStr);
      } else {
        if (!slotOccupationMap[slotTimeStr]) slotOccupationMap[slotTimeStr] = new Set();
        slotOccupationMap[slotTimeStr].add(apptProfId);
      }
    });

    if (selectedProfessionalId === 'any_professional') {
      if (!sessionState.slotOccupation) {
        sessionState.slotOccupation = {};
      }
      for (const [slot, busyProfs] of Object.entries(slotOccupationMap)) {
        sessionState.slotOccupation[slot] = busyProfs;
        if (busyProfs.size >= maxCapacity) {
          busySlots.add(slot);
        }
      }
    }

    const currentDate = moment.tz(timeZone).startOf('day');
    let daysFound = 0;
    
    for (let i = 0; i < 30 && daysFound < daysToShow; i++) {
      const dayOfWeek = currentDate.day();
      if (!daysAvailable.includes(dayOfWeek)) {
        currentDate.add(1, 'day');
        continue;
      }
      daysFound++;

      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const slotTime = currentDate.clone().hour(startH).minute(startM).second(0);
      const endLoopTime = currentDate.clone().hour(endH).minute(endM).second(0);

      while (slotTime.isBefore(endLoopTime)) {
        const slotId = slotTime.format('YYYY-MM-DD HH:mm');
        
        if (slotTime.isBefore(minimumSlotTime)) {
          slotTime.add(intervalMinutes, 'minutes');
          continue;
        }

        let isInBreak = false;
        if (breakTimes && breakTimes.length > 0) {
          for (const breakTime of breakTimes) {
            const [breakStartH, breakStartM] = breakTime.start.split(':').map(Number);
            const [breakEndH, breakEndM] = breakTime.end.split(':').map(Number);
            const breakStart = currentDate.clone().hour(breakStartH).minute(breakStartM);
            const breakEnd = currentDate.clone().hour(breakEndH).minute(breakEndM);
            
            if (slotTime.isSameOrAfter(breakStart) && slotTime.isBefore(breakEnd)) {
              isInBreak = true;
              break;
            }
          }
        }

        if (isInBreak || busySlots.has(slotId)) {
          slotTime.add(intervalMinutes, 'minutes');
          continue;
        }

        availableSlots.push({
          id: slotId,
          title: slotTime.clone().locale('es').format('ddd MMM DD YYYY HH:mm'),
        });
        slotTime.add(intervalMinutes, 'minutes');
      }
      currentDate.add(1, 'day');
    }
    return availableSlots;
  }

  async createCalendarEvent(
    newSessionData: any,
    flowNavigate: any,
    numberId: string,
    userNumber: string,
    sessionState: Record<string, any>
  ): Promise<void> {
    const screenConfig = flowNavigate.__SCREEN_CONFIG__?.SCREENS;
    if (!screenConfig) return;

    let apptConfig: any = null;
    let foundMapping: any = null;
    const sessionValues = Object.values(newSessionData);
    const screenKeys = Object.keys(screenConfig);

    for (const key of screenKeys) {
      const screen = screenConfig[key];
      if (screen.type === 'appointmentNode' && screen.config?.resourceMapping) {
        const mapping = screen.config.resourceMapping;
        for (const value of sessionValues) {
          if (typeof value === 'string' && mapping[value]) {
            apptConfig = screen.config;
            foundMapping = mapping[value];
            break;
          }
        }
      }
      if (apptConfig) break;
    }

    if (!apptConfig) {
      const firstKey = screenKeys.find((k) => screenConfig[k].type === 'appointmentNode');
      if (firstKey) apptConfig = screenConfig[firstKey].config;
    }
    if (!apptConfig) return;

    const tool = apptConfig.tool;
    const selectedSlot = newSessionData.date;
    const resourceMapping = apptConfig.resourceMapping || {};
    const hasResources = Object.keys(resourceMapping).length > 0;

    if (!selectedSlot || tool !== 'google_calendar') {
      this.logger.warn(`[DYN] Flow finalizado sin slot o herramienta incorrecta.`);
      return;
    }

    const [date, time] = selectedSlot.split(' ');
    let title = apptConfig.appointmentDescription || 'Cita Agendada';
    const duration = apptConfig.intervalMinutes || 60;
    const userName = newSessionData.userName || '';
    
    let selectedProfessionalId = 'any_professional';
    let professionalDisplayName = '';

    if (hasResources) {
      if (foundMapping) {
        selectedProfessionalId = foundMapping.id;
        professionalDisplayName = foundMapping.nombre;
      } else {
        const allResources = Object.values(resourceMapping) as any[];
        const allResourceIds = allResources.map((r) => r.id).filter((id) => id !== 'any_professional');
        const occupation = sessionState.slotOccupation?.[selectedSlot] || new Set();
        const availableResourceIds = allResourceIds.filter((id) => !occupation.has(id));

        if (availableResourceIds.length > 0) {
          const randomIndex = Math.floor(Math.random() * availableResourceIds.length);
          selectedProfessionalId = availableResourceIds[randomIndex];
          const foundResource = allResources.find((r) => r.id === selectedProfessionalId);
          if (foundResource) professionalDisplayName = foundResource.nombre;
          this.logger.log(`[DYN] Asignación abierta. Recurso seleccionado: ${selectedProfessionalId}`);
        } else {
          this.logger.error('[DYN] Error: Slot marcado disponible pero sin recursos libres.');
          selectedProfessionalId = 'any_professional';
        }
      }
    } else {
      this.logger.log(`[DYN] Agenda General. Guardando como 'any_professional'.`);
      selectedProfessionalId = 'any_professional';
    }

    title = title.replace(/\$\{data\.(\w+)\}/g, (match, key) => {
      return newSessionData[key] ? String(newSessionData[key]) : match;
    });
    title = title.replace(/\$\{user\.phone\}/g, userNumber);
    if (userName) title += ` - ${userName} `;
    if (selectedProfessionalId !== 'any_professional' && professionalDisplayName) {
      title += ` (Prof: ${professionalDisplayName})`;
    }

    const guestEmail = newSessionData.email ? [newSessionData.email] : [];
    const guestEmailString = guestEmail.length > 0 ? guestEmail[0] : null;

    try {
      const googleEvent: any = await this.calendarService.createEvent(
        numberId, date, time, title, duration, guestEmail
      );
      
      const googleEventId = googleEvent?.id || 'unknown';
      const meetingLink = googleEvent.hangoutLink || googleEvent.htmlLink || '';

      await this.dynamoService.saveAppointment(
        numberId, selectedSlot, userNumber, title, duration, guestEmailString, googleEventId, selectedProfessionalId, userName, meetingLink
      );

      this.logger.log(`[DYN] Cita guardada. Cliente: ${userName}, Link: ${meetingLink}`);
    } catch (calendarError) {
      this.logger.error(`[DYN] FALLO al crear cita en Google Calendar!`, calendarError);
    }
  }
}