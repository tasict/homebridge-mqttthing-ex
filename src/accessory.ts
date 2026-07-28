import type { AccessoryConfig, AccessoryPlugin, API, Controller, Logging, Service } from 'homebridge';

import type { ThingConfig } from './config.js';
import { applyAccessoryInformation, buildThingServices, publishStartPub } from './core/thing-builder.js';
import type { Log } from './log.js';
import { init as mqttInit } from './mqtt/client.js';
import type { MqttContext } from './mqtt/context.js';

export class MqttThingAccessory implements AccessoryPlugin {
  private readonly config: ThingConfig;
  private readonly ctx: MqttContext | null = null;
  private services: Service[] = [];
  private readonly controllers: Controller[] = [];
  private readonly throttledCallTimers: Record<string, NodeJS.Timeout | null> = {};
  private readonly log: Log;

  constructor(log: Logging, accessoryConfig: AccessoryConfig, private readonly api: API) {
    this.log = log as unknown as Log;
    this.config = accessoryConfig as unknown as ThingConfig;

    // Initialize MQTT client (upstream index.js:41-47)
    try {
      const ctx: MqttContext = {
        log: this.log,
        config: this.config,
        homebridgePath: api.user.storagePath(),
        mqttDispatch: {},
        propDispatch: {},
        state: {},
      };
      mqttInit(ctx);
      this.ctx = ctx;
    } catch (ex) {
      this.log.error('MQTT initialisation failed: ' + ex);
      return; // accessory stays empty, like upstream's stub
    }

    // Create services eagerly, matching upstream timing (index.js:3599-3605):
    // startPub publishing happens at construction, and a failure leaves an
    // empty accessory rather than crashing Homebridge.
    try {
      this.services = this.createServices();
    } catch (ex) {
      this.log.error('Exception while creating services: ' + ex);
      this.log((ex as Error).stack ?? '');
      this.services = [];
    }
  }

  getServices(): Service[] {
    return this.services;
  }

  getControllers(): Controller[] {
    return this.controllers;
  }

  // Equivalent of upstream createServices() (index.js:3555-3595).
  private createServices(): Service[] {
    const config = this.config;
    if (!this.ctx) {
      return [];
    }

    const services = buildThingServices({
      ctx: this.ctx,
      config,
      log: this.log,
      api: this.api,
      controllers: this.controllers,
      throttledCallTimers: this.throttledCallTimers,
    });

    if (!services) {
      return [];
    }

    // accessory information service
    services.push(this.makeAccessoryInformationService());

    // start-up publishing
    publishStartPub(this.ctx, config);

    return services;
  }

  private makeAccessoryInformationService(): Service {
    const informationService = new this.api.hap.Service.AccessoryInformation();
    applyAccessoryInformation(informationService, this.api.hap, this.config);
    return informationService;
  }
}
