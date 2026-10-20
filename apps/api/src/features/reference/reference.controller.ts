import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BranchOptionListResponseSchema,
  GstRateListResponseSchema,
  PaymentModeListResponseSchema,
  HsnListQuerySchema,
  KycDocumentTypeListResponseSchema,
  HsnListResponseSchema,
  LeadSourceListResponseSchema,
  StateListResponseSchema,
  UnitListResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  BranchOption,
  GstRate,
  HsnListResponse,
  PaymentMode,
  State,
  Unit,
  KycDocumentType,
  LeadSourceOption,
} from '@erp/contracts';
import { buildPage, escapeLike, toSkipTake } from '../../common/pagination/pagination.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Authenticated } from '../auth/decorators.js';

@ApiTags('reference')
@ApiCookieAuth()
@Controller('reference')
export class ReferenceController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Authenticated()
  @Get('states')
  @ApiOkResponse({ schema: toOpenApiSchema(StateListResponseSchema) })
  async states(): Promise<State[]> {
    const rows = await this.prisma.state.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  /** Every active branch, by code. Any signed-in user may see them: a transfer is asked for from a branch you do not work in. */
  @Authenticated()
  @Get('branches')
  @ApiOkResponse({ schema: toOpenApiSchema(BranchOptionListResponseSchema) })
  async branches(): Promise<BranchOption[]> {
    const rows = await this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
    return rows;
  }

  @Authenticated()
  @Get('kyc-document-types')
  @ApiOkResponse({ schema: toOpenApiSchema(KycDocumentTypeListResponseSchema) })
  async kycDocumentTypes(): Promise<KycDocumentType[]> {
    const rows = await this.prisma.kycDocumentType.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  @Authenticated()
  @Get('lead-sources')
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSourceListResponseSchema) })
  async leadSources(): Promise<LeadSourceOption[]> {
    const rows = await this.prisma.leadSource.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  @Authenticated()
  @Get('units')
  @ApiOkResponse({ schema: toOpenApiSchema(UnitListResponseSchema) })
  async units(): Promise<Unit[]> {
    const rows = await this.prisma.unitOfMeasure.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  @Authenticated()
  @Get('payment-modes')
  @ApiOkResponse({ schema: toOpenApiSchema(PaymentModeListResponseSchema) })
  async paymentModes(): Promise<PaymentMode[]> {
    const rows = await this.prisma.paymentMode.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  @Authenticated()
  @Get('gst-rates')
  @ApiOkResponse({ schema: toOpenApiSchema(GstRateListResponseSchema) })
  async gstRates(): Promise<GstRate[]> {
    const rows = await this.prisma.gstRate.findMany({
      where: { isActive: true },
      orderBy: { rate: 'asc' },
    });
    return rows.map((row) => ({ rate: row.rate.toFixed(2), label: row.label }));
  }

  @Authenticated()
  @Get('hsn-codes')
  @ApiOkResponse({ schema: toOpenApiSchema(HsnListResponseSchema) })
  async hsnCodes(@Query() rawQuery: Record<string, unknown>): Promise<HsnListResponse> {
    const query = HsnListQuerySchema.parse(rawQuery);
    const search = query.search?.trim();
    const where = {
      isActive: true,
      ...(search
        ? {
            OR: [
              { code: { startsWith: escapeLike(search) } },
              { description: { contains: escapeLike(search), mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.hsnCode.findMany({ where, orderBy: { code: 'asc' }, ...toSkipTake(query) }),
      this.prisma.hsnCode.count({ where }),
    ]);
    return buildPage(
      rows.map((row) => ({
        code: row.code,
        description: row.description,
        gstRate: row.gstRate === null ? null : row.gstRate.toFixed(2),
      })),
      total,
      query,
    );
  }
}
