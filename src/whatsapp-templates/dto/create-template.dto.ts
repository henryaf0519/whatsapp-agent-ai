// whatsapp-agent-ai/src/whatsapp-templates/dto/create-template.dto.ts
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsIn,
  ValidateNested,
  IsEnum,
} from 'class-validator';

// --- DTOs para Botones ---

class QuickReplyButtonDto {
  @IsIn(['QUICK_REPLY'])
  type!: 'QUICK_REPLY';

  @IsString()
  @IsNotEmpty()
  text!: string;
}

class UrlButtonDto {
  @IsIn(['URL'])
  type!: 'URL';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  example?: string[];
}

class PhoneNumberButtonDto {
  @IsIn(['PHONE_NUMBER'])
  type!: 'PHONE_NUMBER';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsString()
  @IsNotEmpty()
  phone_number!: string;
}

// --- DTOs para Componentes ---

class HeaderTextDto {
  @IsIn(['HEADER'])
  type!: 'HEADER';

  @IsIn(['TEXT'])
  format!: 'TEXT';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  example?: { header_text: string[] };
}

class HeaderMediaDto {
  @IsIn(['HEADER'])
  type!: 'HEADER';

  @IsIn(['IMAGE', 'VIDEO', 'DOCUMENT'])
  format!: 'IMAGE' | 'VIDEO' | 'DOCUMENT';

  @IsOptional()
  example?: { header_handle: string[] };
}

class BodyDto {
  @IsIn(['BODY'])
  type!: 'BODY';

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  example?: { body_text: string[][] };
}

class FooterDto {
  @IsIn(['FOOTER'])
  type!: 'FOOTER';

  @IsString()
  @IsNotEmpty()
  text!: string;
}

class ButtonsDto {
  @IsIn(['BUTTONS'])
  type!: 'BUTTONS';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: QuickReplyButtonDto, name: 'QUICK_REPLY' },
        { value: UrlButtonDto, name: 'URL' },
        { value: PhoneNumberButtonDto, name: 'PHONE_NUMBER' },
      ],
    },
  })
  buttons!: (QuickReplyButtonDto | UrlButtonDto | PhoneNumberButtonDto)[];
}

// --- DTO Principal ---

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
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: HeaderTextDto, name: 'HEADER' },
        { value: HeaderMediaDto, name: 'HEADER' },
        { value: BodyDto, name: 'BODY' },
        { value: FooterDto, name: 'FOOTER' },
        { value: ButtonsDto, name: 'BUTTONS' },
      ],
    },
  })
  components!: (
    | HeaderTextDto
    | HeaderMediaDto
    | BodyDto
    | FooterDto
    | ButtonsDto
  )[];
}
