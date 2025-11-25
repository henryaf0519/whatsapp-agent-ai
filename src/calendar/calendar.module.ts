import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { DatabaseModule } from 'src/database/database.module';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [DatabaseModule],
  providers: [CalendarService],
  controllers: [CalendarController],
  exports: [CalendarService],
})
export class CalendarModule {}
