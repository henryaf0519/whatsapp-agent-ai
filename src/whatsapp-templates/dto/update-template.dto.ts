import {
  IsArray,
  IsObject,
  ValidateNested,
  IsString,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

// DTO para validar la estructura de los componentes de la plantilla
class TemplateComponentDto {
  // ✅ CAMBIO: De @IsObject() a @IsString()
  @IsString()
  type!: string;

  // Podemos añadir más validaciones para ser más robustos (opcional)
  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsObject()
  example?: any;

  @IsOptional()
  @IsArray()
  buttons?: any[];
}

export class UpdateTemplateDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentDto)
  components!: TemplateComponentDto[];
}
