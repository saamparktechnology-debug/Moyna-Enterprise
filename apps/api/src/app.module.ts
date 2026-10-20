import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './common/config/config.module.js';
import type { Env } from './common/config/env.js';
import { CoreModule } from './common/core.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { AppLoggerModule } from './common/logging/logger.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { PurchasingModule } from './features/purchasing/purchasing.module.js';
import { ReferenceModule } from './features/reference/reference.module.js';
import { AuthModule } from './features/auth/auth.module.js';
import { BillingModule } from './features/billing/billing.module.js';
import { BrokersModule } from './features/brokers/brokers.module.js';
import { HrModule } from './features/hr/hr.module.js';
import { LeadsModule } from './features/leads/leads.module.js';
import { ExchangesModule } from './features/exchanges/exchanges.module.js';
import { PaymentsModule } from './features/payments/payments.module.js';
import { QuotationsModule } from './features/quotations/quotations.module.js';
import { BranchesModule } from './features/branches/branches.module.js';
import { RolesModule } from './features/roles/roles.module.js';
import { UsersModule } from './features/users/users.module.js';
import { HealthModule } from './features/health/health.module.js';
import { CustomersModule } from './features/customers/customers.module.js';
import { ItemsModule } from './features/items/items.module.js';
import { BatteriesModule } from './features/batteries/batteries.module.js';
import { StockModule } from './features/stock/stock.module.js';
import { TransfersModule } from './features/transfers/transfers.module.js';
import { NotificationsModule } from './features/notifications/notifications.module.js';
import { SettingsModule } from './features/settings/settings.module.js';
import { AuditViewerModule } from './features/audit/audit.module.js';
import { ReportsModule } from './features/reports/reports.module.js';
import { SearchModule } from './features/search/search.module.js';
import { DashboardsModule } from './features/dashboards/dashboards.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        AppLoggerModule.forRoot(env),
        PrismaModule,
        CoreModule,
        AuthModule,
        UsersModule,
        RolesModule,
        HealthModule,
        BranchesModule,
        ReferenceModule,
        ItemsModule,
        CustomersModule,
        BillingModule,
        PaymentsModule,
        LeadsModule,
        BrokersModule,
        QuotationsModule,
        ExchangesModule,
        HrModule,
        StockModule,
        TransfersModule,
        PurchasingModule,
        BatteriesModule,
        DashboardsModule,
        NotificationsModule,
        SearchModule,
        ReportsModule,
        SettingsModule,
        AuditViewerModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    };
  }
}
