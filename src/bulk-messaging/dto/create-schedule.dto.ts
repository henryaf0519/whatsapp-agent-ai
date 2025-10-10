// src/bulk-messaging/dto/create-schedule.dto.ts
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsDateString,
  IsOptional,
  IsIn,
  ValidateNested,
} from 'class-validator';

class PhoneNumberDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  number!: string;
}

export class CreateScheduleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // 2. Se añade 'templateName' que es el campo que realmente enviamos ahora.
  @IsString()
  @IsNotEmpty()
  templateName!: string;

  // 3. Se valida que 'phoneNumbers' sea un array de los objetos que definimos arriba.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhoneNumberDto)
  phoneNumbers!: PhoneNumberDto[];

  @IsIn(['once', 'recurring'])
  @IsNotEmpty()
  scheduleType!: 'once' | 'recurring';

  @IsString()
  @IsOptional()
  sendAt?: string;

  @IsString()
  @IsOptional()
  cronExpression?: string;
}
