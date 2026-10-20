import type { Prisma } from '@prisma/client';
import type { Customer, KycStatusName } from '@erp/contracts';

export const CUSTOMER_INCLUDE = { state: true } satisfies Prisma.CustomerInclude;
export type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof CUSTOMER_INCLUDE }>;

export function toCustomerDto(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    stateCode: row.stateCode,
    stateName: row.state?.name ?? null,
    gstin: row.gstin,
    kycStatus: row.kycStatus as KycStatusName,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export function customerSnapshot(row: CustomerRow): Record<string, unknown> {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    stateCode: row.stateCode,
    gstin: row.gstin,
    kycStatus: row.kycStatus,
  };
}
