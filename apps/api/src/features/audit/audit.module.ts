import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditViewerService } from './audit-viewer.service.js';

@Module({ controllers: [AuditController], providers: [AuditViewerService] })
export class AuditViewerModule {}
