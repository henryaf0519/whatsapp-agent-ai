import { Module } from '@nestjs/common';
import { CrmController } from './crm/crm.controller';
import { CrmService } from './crm/crm.service';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
