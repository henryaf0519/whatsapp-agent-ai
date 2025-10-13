import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
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

  @IsString()
  @IsNotEmpty()
  templateName!: string;

  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhoneNumberDto)
  phoneNumbers!: PhoneNumberDto[];

  @IsIn(['once', 'recurring'])
  @IsNotEmpty()
  scheduleType!: 'once' | 'recurring';

  @IsString()
  @IsNotEmpty()
  waba_id!: string;

  @IsString()
  @IsNotEmpty()
  number_id!: string;

  @IsString()
  @IsOptional()
  sendAt?: string;

  @IsString()
  @IsOptional()
  cronExpression?: string;
}
