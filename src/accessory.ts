import os from 'node:os';

import type { AccessoryConfig, AccessoryPlugin, API, Controller, Logging, Service } from 'homebridge';

import { normalizeHistoryConfig, type ThingConfig } from './config.js';
import { makeThingContext } from './hap/binding.js';
import type { Log } from './log.js';
import { init as mqttInit } from './mqtt/client.js';
import type { MqttContext } from './mqtt/context.js';
import { publish as mqttPublish } from './mqtt/wiring.js';
import { buildServicesForConfig } from './services/index.js';
import { getPluginVersion } from './settings.js';

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
    let services: Service[] | null;

    if (config.type === 'custom' && config.services) {
      // multi-service/custom configuration...
      services = [];
      for (const svcCfg of config.services) {
        const merged: ThingConfig = { ...config, ...svcCfg };
        if (!Object.prototype.hasOwnProperty.call(merged, 'subtype')) {
          merged.subtype = merged.name;
        }
        services = [...services, ...(this.configToServices(merged) ?? [])];
      }
    } else {
      // single accessory
      services = this.configToServices(config);
    }

    if (!services) {
      return [];
    }

    // accessory information service
    services.push(this.makeAccessoryInformationService());

    // start-up publishing
    if (config.startPub && this.ctx) {
      if (Array.isArray(config.startPub)) {
        // new format - [ { topic: x, message: y }, ... ]
        for (const entry of config.startPub) {
          if (entry.topic) {
            mqttPublish(this.ctx, entry.topic, 'startPub', entry.message || '');
          }
        }
      } else {
        // old format - object of topic->message
        for (const topic in config.startPub) {
          if (Object.prototype.hasOwnProperty.call(config.startPub, topic)) {
            mqttPublish(this.ctx, topic, 'startPub', config.startPub[topic]);
          }
        }
      }
    }

    return services;
  }

  // Equivalent of upstream configToServices() for one (sub-)service config.
  private configToServices(config: ThingConfig): Service[] | null {
    if (!this.ctx) {
      return null;
    }
    normalizeHistoryConfig(config);
    const thing = makeThingContext({
      mqttCtx: this.ctx,
      config,
      log: this.log,
      hap: this.api.hap,
      controllers: this.controllers,
      versionGreaterOrEqual: this.api.versionGreaterOrEqual
        ? this.api.versionGreaterOrEqual.bind(this.api)
        : undefined,
      throttledCallTimers: this.throttledCallTimers,
    });
    return buildServicesForConfig(thing);
  }

  private makeAccessoryInformationService(): Service {
    const { Service, Characteristic } = this.api.hap;
    const config = this.config;
    const informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, config.manufacturer || 'mqttthing')
      .setCharacteristic(Characteristic.Model, config.model || config.type)
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || os.hostname() + '-' + config.name)
      .setCharacteristic(Characteristic.FirmwareRevision, config.firmwareRevision || getPluginVersion());
    return informationService;
  }
}
