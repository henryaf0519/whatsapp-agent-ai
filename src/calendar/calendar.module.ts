import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { DatabaseModule } from 'src/database/database.module'; // Importamos DatabaseModule

@Module({
  imports: [DatabaseModule],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
