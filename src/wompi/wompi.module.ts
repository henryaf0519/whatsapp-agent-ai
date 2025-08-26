import { Module } from '@nestjs/common';
import { WompiService } from './wompi/wompi.service';
import { WompiController } from './wompi/wompi.controller';

@Module({
  providers: [WompiService],
  controllers: [WompiController]
})
export class WompiModule {}
