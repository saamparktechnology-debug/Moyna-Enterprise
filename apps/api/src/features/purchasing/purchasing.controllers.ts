import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  DiscrepancyListResponseSchema,
  DiscrepancySchema,
  GoodsReceiptListResponseSchema,
  GoodsReceiptSchema,
  PurchaseOrderListResponseSchema,
  PurchaseOrderSchema,
  PurchaseReturnListResponseSchema,
  PurchaseReturnSchema,
  SupplierDetailSchema,
  SupplierLedgerResponseSchema,
  SupplierListResponseSchema,
  SupplierPaymentSchema,
  SupplierSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  Discrepancy,
  DiscrepancyListResponse,
  GoodsReceipt,
  GoodsReceiptListResponse,
  PurchaseOrder,
  PurchaseOrderListResponse,
  PurchaseReturn,
  PurchaseReturnListResponse,
  Supplier,
  SupplierDetail,
  SupplierLedgerResponse,
  SupplierListResponse,
  SupplierPayment,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { DiscrepanciesService } from './discrepancies.service.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import { SuppliersService } from './suppliers.service.js';

const id = () => new ParseUUIDPipe();

@ApiTags('purchasing')
@ApiCookieAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(@Inject(SuppliersService) private readonly suppliers: SuppliersService) {}

  @RequirePermission('suppliers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(SupplierListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<SupplierListResponse> {
    return this.suppliers.list(query);
  }

  @RequirePermission('suppliers.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(SupplierDetailSchema) })
  get(@Param('id', id()) supplierId: string): Promise<SupplierDetail> {
    return this.suppliers.get(supplierId);
  }

  @RequirePermission('suppliers.view')
  @Get(':id/ledger')
  @ApiOkResponse({ schema: toOpenApiSchema(SupplierLedgerResponseSchema) })
  ledger(
    @Param('id', id()) supplierId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<SupplierLedgerResponse> {
    return this.suppliers.ledger(supplierId, query);
  }

  @RequirePermission('suppliers.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(SupplierSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Supplier> {
    return this.suppliers.create(auth, body);
  }

  @RequirePermission('suppliers.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(SupplierSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) supplierId: string,
    @Body() body: unknown,
  ): Promise<Supplier> {
    return this.suppliers.update(auth, supplierId, body);
  }

  @RequirePermission('supplier_payments.create')
  @Post(':id/payments')
  @ApiCreatedResponse({ schema: toOpenApiSchema(SupplierPaymentSchema) })
  pay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) supplierId: string,
    @Body() body: unknown,
  ): Promise<SupplierPayment> {
    return this.suppliers.recordPayment(auth, supplierId, body);
  }
}

@ApiTags('purchasing')
@ApiCookieAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(GoodsReceiptsService) private readonly receipts: GoodsReceiptsService,
  ) {}

  @RequirePermission('purchases.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseOrderListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<PurchaseOrderListResponse> {
    return this.orders.list(query);
  }

  @RequirePermission('purchases.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseOrderSchema) })
  get(@Param('id', id()) poId: string): Promise<PurchaseOrder> {
    return this.orders.get(poId);
  }

  @RequirePermission('purchases.create')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(PurchaseOrderSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<PurchaseOrder> {
    return this.orders.create(auth, body);
  }

  @RequirePermission('purchases.create')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseOrderSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) poId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrder> {
    return this.orders.update(auth, poId, body);
  }

  @RequirePermission('purchases.approve')
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseOrderSchema) })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) poId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrder> {
    return this.orders.approve(auth, poId, body);
  }

  @RequirePermission('purchases.approve')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseOrderSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) poId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrder> {
    return this.orders.cancel(auth, poId, body);
  }

  @RequirePermission('purchases.receive')
  @Post(':id/receive')
  @ApiCreatedResponse({ schema: toOpenApiSchema(GoodsReceiptSchema) })
  receive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) poId: string,
    @Body() body: unknown,
  ): Promise<GoodsReceipt> {
    return this.receipts.receive(auth, poId, body);
  }
}

@ApiTags('purchasing')
@ApiCookieAuth()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(@Inject(GoodsReceiptsService) private readonly receipts: GoodsReceiptsService) {}

  @RequirePermission('purchases.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(GoodsReceiptListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<GoodsReceiptListResponse> {
    return this.receipts.list(query);
  }

  @RequirePermission('purchases.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(GoodsReceiptSchema) })
  get(@Param('id', id()) receiptId: string): Promise<GoodsReceipt> {
    return this.receipts.get(receiptId);
  }
}

@ApiTags('purchasing')
@ApiCookieAuth()
@Controller('discrepancies')
export class DiscrepanciesController {
  constructor(@Inject(DiscrepanciesService) private readonly discrepancies: DiscrepanciesService) {}

  @RequirePermission('discrepancies.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(DiscrepancyListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<DiscrepancyListResponse> {
    return this.discrepancies.list(query);
  }

  @RequirePermission('discrepancies.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(DiscrepancySchema) })
  get(@Param('id', id()) discrepancyId: string): Promise<Discrepancy> {
    return this.discrepancies.get(discrepancyId);
  }

  @RequirePermission('discrepancies.resolve')
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(DiscrepancySchema) })
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id()) discrepancyId: string,
    @Body() body: unknown,
  ): Promise<Discrepancy> {
    return this.discrepancies.resolve(auth, discrepancyId, body);
  }
}

@ApiTags('purchasing')
@ApiCookieAuth()
@Controller('purchase-returns')
export class PurchaseReturnsController {
  constructor(@Inject(PurchaseReturnsService) private readonly returns: PurchaseReturnsService) {}

  @RequirePermission('purchases.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseReturnListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<PurchaseReturnListResponse> {
    return this.returns.list(query);
  }

  @RequirePermission('purchases.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(PurchaseReturnSchema) })
  get(@Param('id', id()) returnId: string): Promise<PurchaseReturn> {
    return this.returns.get(returnId);
  }

  @RequirePermission('purchases.return')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(PurchaseReturnSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<PurchaseReturn> {
    return this.returns.create(auth, body);
  }
}
