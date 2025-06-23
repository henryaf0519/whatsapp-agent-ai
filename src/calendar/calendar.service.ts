import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class CalendarService {
  private readonly token: string;
  private readonly calendarId: string;
  private readonly baseUrl = 'https://www.googleapis.com/calendar/v3';

  constructor(private readonly configService: ConfigService) {
    this.token = this.configService.get<string>('GMAIL_ACCESS_TOKEN') || '';
    this.calendarId = this.configService.get<string>('GOOGLE_CALENDAR_ID', 'primary');
  }

  async createEvent(
    date: string,
    time: string,
    title: string,
    durationMinutes = 60,
  ): Promise<unknown> {
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const body = {
      summary: title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    const url = `${this.baseUrl}/calendars/${this.calendarId}/events`;
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }

  async getEvents(date: string): Promise<unknown[]> {
    const timeMin = new Date(`${date}T00:00:00Z`).toISOString();
    const timeMax = new Date(`${date}T23:59:59Z`).toISOString();
    const url = `${this.baseUrl}/calendars/${this.calendarId}/events`;
    const response = await axios.get(url, {
      params: {
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      },
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const data = response.data as { items?: unknown[] };
    return data.items || [];
  }
}
