// Service composition shared by both plugin shells.
//
// Accessory mode (src/accessory.ts) and platform mode (src/platform.ts) differ
// only in how HomeKit accessories are created and published; the work of
// turning one device config into services is identical and lives here.
import os from 'node:os';

import type { API, Controller, HAP, Service } from 'homebridge';

import { normalizeHistoryConfig, type ThingConfig } from '../config.js';
import { makeThingContext } from '../hap/binding.js';
import type { Log } from '../log.js';
import type { MqttContext } from '../mqtt/context.js';
import { publish as mqttPublish } from '../mqtt/wiring.js';
import { buildServicesForConfig } from '../services/index.js';
import { getPluginVersion } from '../settings.js';

export interface ThingBuildParams {
  /** MQTT context of the device being built. */
  ctx: MqttContext;
  /** Full device config, before any "custom" expansion. */
  config: ThingConfig;
  log: Log;
  api: API;
  /** Device-scoped; adaptive lighting controllers are appended while building. */
  controllers: Controller[];
  /** Device-scoped timers shared by all of the device's sub-services. */
  throttledCallTimers: Record<string, NodeJS.Timeout | null>;
}

/**
 * Builds the services for one device, expanding the "custom" multi-service
 * form (upstream createServices(), index.js:3555-3595). The accessory
 * information service is NOT included: each shell attaches its own.
 *
 * Returns null when a single (non-custom) config produced nothing - an
 * unrecognized type, which the caller logs and skips like upstream.
 */
export function buildThingServices(params: ThingBuildParams): Service[] | null {
  const { config } = params;

  if (config.type === 'custom' && config.services) {
    // multi-service/custom configuration...
    let services: Service[] = [];
    for (const svcCfg of config.services) {
      const merged: ThingConfig = { ...config, ...svcCfg };
      if (!Object.prototype.hasOwnProperty.call(merged, 'subtype')) {
        merged.subtype = merged.name;
      }
      services = [...services, ...(buildOneConfig(params, merged) ?? [])];
    }
    return services;
  }

  // single accessory
  return buildOneConfig(params, config);
}

/** Equivalent of upstream configToServices() for one (sub-)service config. */
function buildOneConfig(params: ThingBuildParams, config: ThingConfig): Service[] | null {
  const { ctx, log, api, controllers, throttledCallTimers } = params;
  normalizeHistoryConfig(config);
  const thing = makeThingContext({
    mqttCtx: ctx,
    config,
    log,
    hap: api.hap,
    api,
    controllers,
    versionGreaterOrEqual: api.versionGreaterOrEqual ? api.versionGreaterOrEqual.bind(api) : undefined,
    throttledCallTimers,
  });
  return buildServicesForConfig(thing);
}

/**
 * Start-up publishing, supporting both the array form
 * ([ { topic, message }, ... ]) and the legacy topic->message object.
 */
export function publishStartPub(ctx: MqttContext, config: ThingConfig): void {
  if (!config.startPub) {
    return;
  }
  if (Array.isArray(config.startPub)) {
    // new format - [ { topic: x, message: y }, ... ]
    for (const entry of config.startPub) {
      if (entry.topic) {
        mqttPublish(ctx, entry.topic, 'startPub', entry.message || '');
      }
    }
  } else {
    // old format - object of topic->message
    for (const topic in config.startPub) {
      if (Object.prototype.hasOwnProperty.call(config.startPub, topic)) {
        mqttPublish(ctx, topic, 'startPub', config.startPub[topic]);
      }
    }
  }
}

/**
 * Fills in the accessory information characteristics. Platform mode passes the
 * service Homebridge already created on the PlatformAccessory; accessory mode
 * passes a freshly constructed one.
 */
export function applyAccessoryInformation(service: Service, hap: HAP, config: ThingConfig): void {
  const { Characteristic } = hap;
  service
    .setCharacteristic(Characteristic.Manufacturer, config.manufacturer || 'mqttthing')
    .setCharacteristic(Characteristic.Model, config.model || config.type)
    .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || os.hostname() + '-' + config.name)
    .setCharacteristic(Characteristic.FirmwareRevision, config.firmwareRevision || getPluginVersion());
}
