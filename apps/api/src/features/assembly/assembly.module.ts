import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { AssemblyController } from './assembly.controller.js';
import { AssemblyService } from './assembly.service.js';

@Module({
  imports: [StockModule],
  controllers: [AssemblyController],
  providers: [AssemblyService],
})
export class AssemblyModule {}
