import { Injectable, Logger } from '@nestjs/common';
import { QuotationService } from 'src/quotation/quotation.service';

@Injectable()
export class FlowQuotationMapperService {
  private readonly logger = new Logger(FlowQuotationMapperService.name);

  constructor(private readonly quotationService: QuotationService) {}

  async processQuotation(data: any, numberId: string) {
    this.logger.log('Iniciando procesamiento de cotización con data:', data);

    const cleanNumber = (val: string | undefined) =>
      val ? parseInt(val.toString().replace(/\D/g, ''), 10) : 0;
      
    const isYes = (val: string | undefined) =>
      val ? val.toString().trim().toLowerCase() === 'si' : false;

    const mapRentalProperties = (rango: string | undefined): number => {
      const mapeo: Record<string, number> = {
        '1 a 5': 1, '6 a 10': 2, '11 a 15': 3,
        '16 a 20': 4, '21 a 25': 5, '25 o más': 6,
      };
      return rango ? mapeo[rango.trim()] || 0 : 0;
    };

    const mapMonthToId = (mesInput: string | undefined): number => {
      if (!mesInput) return 0;
      const cleanVal = mesInput.toString().trim().toLowerCase();
      const parsedNum = parseInt(cleanVal, 10);
      if (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= 12) return parsedNum;

      const mesesMap: Record<string, number> = {
        'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
        'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
        'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
      };
      return mesesMap[cleanVal] || 0;
    };

    const finalFullName = data['NOMBRE COMPLETO']?.trim().substring(0, 100) || '';
    const finalEmail = data['EMAIL']?.trim().substring(0, 50) || '';
    const finalRentAmount = cleanNumber(data['VALOR DEL CANON']);
    const finalContractDuration = cleanNumber(data['DURACIÓN CONTRATO']);
    const valorAdministracion = cleanNumber(data['VALOR ADMINISTRACION']);
    const finalMaintenanceFee = valorAdministracion > 0 ? valorAdministracion : 0;
    const faltantes = cleanNumber(data['FALTANTES']);
    const cantidadInmuebles = data['CANTIDAD INMUEBLES']?.trim();
    const codigoAsesor = data['CODIGO ASESOR']?.trim();
    const rawMonthValue = data[' EN QUÉ MES VENCE?'];
    const monthId = mapMonthToId(rawMonthValue);
    const isCurrentlyRentedValue = monthId > 0;

    const signatureCalculada = Math.trunc(
      (finalFullName.length * finalEmail.length + (finalRentAmount + finalMaintenanceFee)) * finalContractDuration
    );

    const payload: any = {
      id: 0,
      tenantId: 2,
      channel: 'whatsapp-bot-test',
      fullName: finalFullName,
      phoneNumber: data['TELÉFONO / WHATSAPP']?.replace(/[^\d\s\+\-\(\)]/g, '').substring(0, 20) || '',
      email: finalEmail,
      isOwner: data[' QUIEN ERES?']?.trim().toLowerCase() === 'propietario',
      isNaturalPerson: data[' ERES PERSONA O EMPRESA?']?.trim().toLowerCase() === 'persona natural',
      isResidentialDestination: data[' CUAL ES EL USO DEL INMUEBLE?']?.trim().toLowerCase() === 'residencial',
      isCurrentlyRented: isCurrentlyRentedValue,
      ...(isCurrentlyRentedValue && { contractExpirationMonth: monthId }),
      acceptTerms: true,
      rentAmount: finalRentAmount,
      contractDuration: finalContractDuration,
      vatApply: isYes(data['COBERTURA IVA']),
      homeAssistance: isYes(data['ASISTENCIA DOMICILIARIA']),
      maintenanceFeeApply: valorAdministracion > 0,
      ...(valorAdministracion > 0 && { maintenanceFee: valorAdministracion }),
      damagesMissingApply: faltantes > 0,
      ...(faltantes > 0 && { damagesMissing: faltantes }),
      hasMoreRentProperties: !!cantidadInmuebles,
      ...(cantidadInmuebles && { howManyMoreRentalProperties: mapRentalProperties(cantidadInmuebles) }),
      receivedHelpFromAdvisor: !!codigoAsesor,
      ...(codigoAsesor && { advisorCode: codigoAsesor }),
      signature: signatureCalculada
    };

    this.logger.log(`[COTIZACIÓN] Payload enviado a la API`);
    try {
      const apiResponse = await this.quotationService.calculateQuotation(payload);
      if (apiResponse && apiResponse.plans && Array.isArray(apiResponse.plans)) {
        data.fullQuotationResponse = apiResponse;
        this.logger.log(`[COTIZACIÓN] Respuesta completa guardada en sesión.`);
        return this.quotationService.formatPlansMessage(apiResponse.plans);
      } else {
        throw new Error("La API no devolvió un arreglo válido de planes.");
      }
    } catch (error) {
      this.logger.error(`[COTIZACIÓN] Error en el proceso de cotización`, error);
      return ` Ocurrió un error al generar tu cotización. Por favor, intenta de nuevo más tarde o comunícate con un asesor.`;
    }
  }
}