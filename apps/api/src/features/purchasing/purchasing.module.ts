import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { DiscrepanciesService } from './discrepancies.service.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import {
  DiscrepanciesController,
  GoodsReceiptsController,
  PurchaseOrdersController,
  PurchaseReturnsController,
  SuppliersController,
} from './purchasing.controllers.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [StockModule],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    DiscrepanciesController,
    PurchaseReturnsController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    DiscrepanciesService,
    PurchaseReturnsService,
  ],
  exports: [PurchaseOrdersService, DiscrepanciesService, PurchaseReturnsService],
})
export class PurchasingModule {}
