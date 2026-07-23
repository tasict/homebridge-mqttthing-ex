import os from 'node:os';

import type { AccessoryConfig, AccessoryPlugin, API, Controller, Logging, Service } from 'homebridge';

import { normalizeHistoryConfig, type ThingConfig } from './config.js';
import type { Log } from './log.js';
import { init as mqttInit } from './mqtt/client.js';
import type { MqttContext } from './mqtt/context.js';
import { getPluginVersion } from './settings.js';

export class MqttThingAccessory implements AccessoryPlugin {
  private readonly config: ThingConfig;
  private readonly ctx: MqttContext | null = null;
  private services: Service[] | null = null;
  private readonly controllers: Controller[] = [];

  constructor(
    private readonly log: Logging,
    accessoryConfig: AccessoryConfig,
    private readonly api: API,
  ) {
    this.config = accessoryConfig as unknown as ThingConfig;
    normalizeHistoryConfig(this.config);

    try {
      const ctx: MqttContext = {
        log: log as unknown as Log,
        config: this.config,
        homebridgePath: api.user.storagePath(),
        mqttDispatch: {},
        propDispatch: {},
        state: {},
      };
      mqttInit(ctx);
      this.ctx = ctx;
    } catch (ex) {
      log.error('Exception while connecting to MQTT: ' + ex);
    }
  }

  // Services are created lazily on the first getServices() call and wrapped
  // in a broad try/catch, matching upstream error containment (index.js:3599)
  // where a service-creation failure logs and yields an empty accessory.
  getServices(): Service[] {
    if (this.services === null) {
      try {
        this.services = this.createServices();
      } catch (ex) {
        this.log.error('Exception while creating services: ' + ex);
        this.log.error((ex as Error).stack ?? '');
        this.services = [];
      }
    }
    return this.services;
  }

  getControllers(): Controller[] {
    return this.controllers;
  }

  private createServices(): Service[] {
    if (!this.ctx) {
      return [];
    }
    // Type-specific service building arrives with the service registry (M2+).
    return [this.makeAccessoryInformationService()];
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
