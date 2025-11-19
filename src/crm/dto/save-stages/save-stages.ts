import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class StageDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsString()
  color!: string;

  @IsBoolean()
  isSystem!: boolean;
}
export class SaveStagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StageDto)
  stages!: StageDto[];
}
