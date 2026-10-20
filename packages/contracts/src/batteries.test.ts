import { describe, expect, it } from 'vitest';
import {
  BatteryAlertsQuerySchema,
  BatteryListQuerySchema,
  InstallBatteryRequestSchema,
  SaleCheckRequestSchema,
  SetBatteryDetailsRequestSchema,
} from './batteries.js';

const unit = '11111111-1111-4111-8111-111111111111';

describe('recording battery details', () => {
  it('defaults every date and the months to empty', () => {
    expect(SetBatteryDetailsRequestSchema.parse({})).toEqual({
      manufacturedOn: null,
      expiryOn: null,
      warrantyMonths: null,
      warrantyEnd: null,
    });
  });

  it('refuses an expiry on or before the manufacture date and a warranty that ends before it', () => {
    const parse = (value: object) => SetBatteryDetailsRequestSchema.safeParse(value);
    expect(parse({ manufacturedOn: '2026-05-01', expiryOn: '2026-05-01' }).success).toBe(false);
    expect(parse({ manufacturedOn: '2026-05-01', expiryOn: '2026-05-02' }).success).toBe(true);
    expect(parse({ manufacturedOn: '2026-05-01', warrantyEnd: '2026-04-30' }).success).toBe(false);
    expect(parse({ expiryOn: '2026-02-30' }).success).toBe(false);
  });

  it('keeps months to whole numbers up to ten years, and the version to one or more', () => {
    const parse = (value: object) => SetBatteryDetailsRequestSchema.safeParse(value);
    expect(parse({ warrantyMonths: 120 }).success).toBe(true);
    expect(parse({ warrantyMonths: 121 }).success).toBe(false);
    expect(parse({ warrantyMonths: 6.5 }).success).toBe(false);
    expect(parse({ rowVersion: 0 }).success).toBe(false);
    expect(parse({ rowVersion: 3 }).success).toBe(true);
  });
});

describe('installing a battery', () => {
  it('needs a vehicle and accepts an optional date and override reason', () => {
    const parse = (value: object) => InstallBatteryRequestSchema.safeParse(value);
    expect(parse({}).success).toBe(false);
    expect(parse({ vehicleSerialUnitId: 'nope' }).success).toBe(false);
    expect(parse({ vehicleSerialUnitId: unit }).success).toBe(true);
    expect(parse({ vehicleSerialUnitId: unit, installedOn: '2026-10-08' }).success).toBe(true);
    expect(parse({ vehicleSerialUnitId: unit, installedOn: '2026-02-30' }).success).toBe(false);
  });

  it('wants a real reason for an override, here and in the sale check', () => {
    expect(
      InstallBatteryRequestSchema.safeParse({ vehicleSerialUnitId: unit, overrideReason: 'ab' })
        .success,
    ).toBe(false);
    expect(
      InstallBatteryRequestSchema.parse({ vehicleSerialUnitId: unit, overrideReason: '  Agreed  ' })
        .overrideReason,
    ).toBe('Agreed');
    expect(SaleCheckRequestSchema.safeParse({}).success).toBe(true);
    expect(SaleCheckRequestSchema.safeParse({ overrideReason: 'x' }).success).toBe(false);
    expect(SaleCheckRequestSchema.safeParse({ overrideReason: 'x'.repeat(301) }).success).toBe(
      false,
    );
  });
});

describe('battery queries', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(BatteryListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      expiry: 'any',
      warranty: 'any',
      installed: 'any',
      withinDays: 30,
    });
    const bad = (value: object) => BatteryListQuerySchema.safeParse(value).success;
    expect(bad({ expiry: 'soonish' })).toBe(false);
    expect(bad({ warranty: 'x' })).toBe(false);
    expect(bad({ installed: 'maybe' })).toBe(false);
    expect(bad({ state: 'LOST' })).toBe(false);
    expect(bad({ withinDays: 0 })).toBe(false);
    expect(bad({ withinDays: 366 })).toBe(false);
    expect(bad({ itemId: 'nope' })).toBe(false);
  });

  it('reads the look-ahead window of the alerts from text', () => {
    expect(BatteryAlertsQuerySchema.parse({}).withinDays).toBe(30);
    expect(BatteryAlertsQuerySchema.parse({ withinDays: '60' }).withinDays).toBe(60);
    expect(BatteryAlertsQuerySchema.safeParse({ withinDays: '0' }).success).toBe(false);
  });
});
