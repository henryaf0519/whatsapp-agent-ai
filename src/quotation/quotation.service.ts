import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class QuotationService {
    private readonly logger = new Logger(QuotationService.name);
    private readonly apiUrl = 'https://mikayros.paisasoft.com/api/Quotations';

    async calculateQuotation(payload: any): Promise<any> {
        this.logger.log(`[QuotationService] Enviando petición a la API...`);
        const url = `${this.apiUrl}/calc`;
        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            this.logger.log(`[QuotationService] Respuesta exitosa recibida.`, response.data);
            return response.data;
        } catch (error: any) {
            this.logger.error(
                `[QuotationService] Error al consumir la API de cotizaciones:`,
                error?.response?.data || error?.message,
            );

            throw new HttpException(
                error?.response?.data || 'Error al procesar la cotización en el servidor externo',
                error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    formatPlansMessage(plans: any[]): string {
        let message = "";

        const planTemplates: Record<string, string> = {
            "Básico": `✅ Canon de arrendamiento.
✅ Cuota administración.
❌ Servicios públicos.
❌ Restitución de inmueble.
✅ Sin codeudor (Hasta 8 mill).
❌ Renovación de póliza con inquilino en mora.
✅ Límite de indemnización: Hasta vigencia de póliza.
Coberturas Opcionales…
✅ Asistencia domiciliaria.
❌ Daños y faltantes al inventario.`,

            "Clásico": `✅ Canon de arrendamiento.
✅ Cuota administración.
✅ Servicios públicos.
✅ Restitución de inmueble.
✅ Sin codeudor (Hasta 8 mill).
✅ Renovación de póliza con inquilino en mora.
✅ Límite de indemnización: 12 meses.
Coberturas Opcionales…
✅ Asistencia domiciliaria.
✅ Daños y faltantes al inventario.`,

            "Global": `✅ Canon de arrendamiento.
✅ Cuota administración.
✅ Servicios públicos.
✅ Restitución de inmueble.
✅ Flexibilidad si no tienes codeudor.
✅ Renovación de póliza con inquilino en mora.
✅ Límite de indemnización: 36 meses.
Coberturas Opcionales…
✅ Asistencia domiciliaria.
✅ Daños y faltantes al inventario.`
        };

        for (const plan of plans) {
            const planName = plan.planName; // ej: "Básico"
            // Formateamos el número para que se vea como "550.000"
            const totalPay = Number(plan.totalPay).toLocaleString('es-CO');
            const template = planTemplates[planName] || "";

            message += `PLAN ${planName.toUpperCase()}: $ ${totalPay} \n${template}\n\n`;
        }

        message += `Ahora selecciona el plan que mejor se acomoda a tus necesidades. Serás contactado por uno de nuestros asesores.`;

        this.logger.log(`[QuotationService] Mensaje formateado para WhatsApp: ${message}`);
        return message;
    }


    async selectPlan(payload: any): Promise<any> {
        this.logger.log(`[QuotationService] Enviando selección de plan a la API...`, payload);
        const url = `${this.apiUrl}/selectPlan`; // Asegúrate de que esta URL sea correcta según tu API

        try {
            const response = await axios.put(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            this.logger.log(`[QuotationService] Plan seleccionado exitosamente.`);
            return response.data;
        } catch (error: any) {
            this.logger.error(
                `[QuotationService] Error al enviar la selección de plan:`,
                error?.response?.data || error?.message,
            );

            throw new HttpException(
                error?.response?.data || 'Error al procesar la selección en el servidor externo',
                error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}