import { Module } from '@nestjs/common';
import { QuotationService } from './quotation.service';

@Module({
  providers: [QuotationService],
  exports: [QuotationService]
})
export class QuotationModule {}
