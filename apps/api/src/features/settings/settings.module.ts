import { Global, Module } from '@nestjs/common';
import { GstRatesService } from './gst-rates.service.js';
import { SeriesService } from './series.service.js';
import {
  DocumentSeriesController,
  GstRatesController,
  SettingsController,
} from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Global so the modules that apply an approval limit can read it without importing this one. */
@Global()
@Module({
  // The fixed paths come first so "settings/gst-rates" is never read as a setting called "gst-rates".
  controllers: [DocumentSeriesController, GstRatesController, SettingsController],
  providers: [SettingsService, SeriesService, GstRatesService],
  exports: [SettingsService],
})
export class SettingsModule {}
