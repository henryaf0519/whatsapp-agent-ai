// src/bulk-messaging/dto/create-schedule.dto.ts
import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsDateString,
  IsOptional,
  IsIn,
} from 'class-validator';

export class CreateScheduleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  phoneNumbers!: string[];

  @IsIn(['once', 'recurring'])
  @IsNotEmpty()
  scheduleType!: 'once' | 'recurring';

  @IsDateString()
  @IsOptional()
  sendAt?: string; // Para envíos únicos (formato ISO 8601)

  @IsString()
  @IsOptional()
  cronExpression?: string; // Para envíos recurrentes (ej: '0 0 * * 1-5')
}
