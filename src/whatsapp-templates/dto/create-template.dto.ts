/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/prefer-as-const */
// src/whatsapp-templates/dto/create-template.dto.ts

import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsIn,
  ValidateNested,
  IsEnum,
  ValidateIf,
  IsObject,
} from 'class-validator';

// --- DTOs para Ejemplos (CORREGIDO) ---
class HeaderExampleDto {
  // Para cuando el header es TEXTO y tiene variables. Ej: ["valor_variable_1"]
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  header_text?: string[];

  // Para cuando el header es MEDIA y ya tenemos el handle (ej. desde el endpoint /upload)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  header_handle?: string[];

  // Para cuando se envía la MEDIA en base64 en la misma petición de creación
  @IsString()
  @IsOptional()
  header_base64?: string;
}

// --- DTO para el ejemplo del Body (sin cambios) ---
class BodyExampleDto {
  @IsArray()
  body_text!: string[][];
}

// --- DTOs para Botones (sin cambios) ---
class ButtonBaseDto {
  @IsString()
  @IsNotEmpty()
  type!: string;
}

class QuickReplyButtonDto extends ButtonBaseDto {
  @IsIn(['QUICK_REPLY'])
  type: 'QUICK_REPLY' = 'QUICK_REPLY';

  @IsString()
  @IsNotEmpty()
  text!: string;
}

class UrlButtonDto extends ButtonBaseDto {
  @IsIn(['URL'])
  type: 'URL' = 'URL';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;

  @ValidateIf((o) => o.url.includes('{{'))
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({
    message: 'Se debe proporcionar un ejemplo para la variable de la URL.',
  })
  example?: string[];
}

class PhoneNumberButtonDto extends ButtonBaseDto {
  @IsIn(['PHONE_NUMBER'])
  type: 'PHONE_NUMBER' = 'PHONE_NUMBER';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsString()
  @IsNotEmpty()
  phone_number!: string;
}

// --- DTOs para Componentes (sin cambios en la lógica) ---
class ComponentBaseDto {
  @IsString()
  @IsNotEmpty()
  type!: string;
}

export class HeaderComponentDto extends ComponentBaseDto {
  @IsIn(['HEADER'])
  type: 'HEADER' = 'HEADER';

  @IsIn(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'])
  format!: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

  @ValidateIf((o) => o.format === 'TEXT')
  @IsString()
  @IsNotEmpty()
  text?: string;

  @ValidateIf(
    (o) =>
      (o.text && o.text.includes('{{')) ||
      ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(o.format),
  )
  @IsObject()
  @ValidateNested()
  @Type(() => HeaderExampleDto)
  @IsNotEmpty({
    message: 'El header con variables o medios requiere un objeto de ejemplo.',
  })
  example?: HeaderExampleDto;
}

class BodyComponentDto extends ComponentBaseDto {
  @IsIn(['BODY'])
  type: 'BODY' = 'BODY';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @ValidateIf((o) => o.text.includes('{{'))
  @IsObject()
  @ValidateNested()
  @Type(() => BodyExampleDto)
  @IsNotEmpty({
    message: 'El body contiene variables y requiere un objeto de ejemplo.',
  })
  example?: BodyExampleDto;
}

class FooterComponentDto extends ComponentBaseDto {
  @IsIn(['FOOTER'])
  type: 'FOOTER' = 'FOOTER';

  @IsString()
  @IsNotEmpty()
  text!: string;
}

class ButtonsComponentDto extends ComponentBaseDto {
  @IsIn(['BUTTONS'])
  type: 'BUTTONS' = 'BUTTONS';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ButtonBaseDto, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: QuickReplyButtonDto, name: 'QUICK_REPLY' },
        { value: UrlButtonDto, name: 'URL' },
        { value: PhoneNumberButtonDto, name: 'PHONE_NUMBER' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  buttons!: (QuickReplyButtonDto | UrlButtonDto | PhoneNumberButtonDto)[];
}

// --- DTO Principal (sin cambios) ---
export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsEnum(['MARKETING', 'UTILITY', 'AUTHENTICATION'])
  category!: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponentBaseDto, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: HeaderComponentDto, name: 'HEADER' },
        { value: BodyComponentDto, name: 'BODY' },
        { value: FooterComponentDto, name: 'FOOTER' },
        { value: ButtonsComponentDto, name: 'BUTTONS' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  components!: (
    | HeaderComponentDto
    | BodyComponentDto
    | FooterComponentDto
    | ButtonsComponentDto
  )[];
}
