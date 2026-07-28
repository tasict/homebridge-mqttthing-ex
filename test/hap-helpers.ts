import { EventEmitter } from 'node:events';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import type { API, PlatformAccessory as PlatformAccessoryType, PlatformConfig } from 'homebridge';
import { vi } from 'vitest';

// The homebridge package only exports its entry point, and that exports
// PlatformAccessory as a type. The real class is reached by path - tests need
// the actual constructor because registerPlatformAccessories identity-checks
// the instances it is given.
import { PlatformAccessory } from '../node_modules/homebridge/dist/platformAccessory.js';
import type { ThingConfig } from '../src/config.js';
import { MqttThingAccessory } from '../src/accessory.js';
import { MqttThingPlatform } from '../src/platform.js';
import { makeTestLog, type TestLog } from './helpers.js';

export function makeMockApi(storagePath: string): API {
  return {
    hap: hapNodeJs,
    version: 2.0,
    serverVersion: '2.0.0',
    versionGreaterOrEqual: () => true,
    user: { storagePath: () => storagePath },
  } as unknown as API;
}

export interface PlatformHarness {
  api: API;
  /** Accessories passed to registerPlatformAccessories. */
  registered: PlatformAccessoryType[];
  updated: PlatformAccessoryType[];
  unregistered: PlatformAccessoryType[];
  /** Builds a cache entry to hand to configureAccessory before launching. */
  makeCachedAccessory(name: string, uuid: string): PlatformAccessoryType;
  finishLaunching(): void;
  shutdown(): void;
}

/**
 * Homebridge API stand-in for platform tests: an event emitter carrying real
 * hap, the real PlatformAccessory class and recorders for the accessory
 * management calls.
 */
export function makePlatformApi(storagePath: string, configPath = ''): PlatformHarness {
  const emitter = new EventEmitter();
  const registered: PlatformAccessoryType[] = [];
  const updated: PlatformAccessoryType[] = [];
  const unregistered: PlatformAccessoryType[] = [];

  const api = Object.assign(emitter, {
    hap: hapNodeJs,
    version: 2.0,
    serverVersion: '2.0.0',
    versionGreaterOrEqual: () => true,
    user: { storagePath: () => storagePath, configPath: () => configPath },
    platformAccessory: PlatformAccessory,
    registerPlatformAccessories: vi.fn((_plugin: string, _platform: string, accessories: PlatformAccessoryType[]) => {
      registered.push(...accessories);
    }),
    updatePlatformAccessories: vi.fn((accessories: PlatformAccessoryType[]) => {
      updated.push(...accessories);
    }),
    unregisterPlatformAccessories: vi.fn(
      (_plugin: string, _platform: string, accessories: PlatformAccessoryType[]) => {
        unregistered.push(...accessories);
      },
    ),
  }) as unknown as API;

  return {
    api,
    registered,
    updated,
    unregistered,
    makeCachedAccessory: (name, uuid) => new PlatformAccessory(name, uuid) as unknown as PlatformAccessoryType,
    finishLaunching: () => emitter.emit('didFinishLaunching'),
    shutdown: () => emitter.emit('shutdown'),
  };
}

export interface TestPlatform extends TestLog {
  platform: MqttThingPlatform;
  harness: PlatformHarness;
}

const openPlatforms: PlatformHarness[] = [];

/**
 * Creates a platform, feeds it any cached accessories and fires
 * didFinishLaunching - the sequence Homebridge itself follows.
 */
export function makePlatform(
  config: Partial<PlatformConfig>,
  harness: PlatformHarness,
  cached: PlatformAccessoryType[] = [],
): TestPlatform {
  const { log, messages } = makeTestLog();
  const fullConfig = { platform: 'mqttthing-ex', ...config } as PlatformConfig;
  const platform = new MqttThingPlatform(log as never, fullConfig, harness.api);
  for (const accessory of cached) {
    platform.configureAccessory(accessory);
  }
  openPlatforms.push(harness);
  harness.finishLaunching();
  return { platform, harness, log, messages };
}

export function closePlatforms(): void {
  for (const harness of openPlatforms) {
    harness.shutdown();
  }
  openPlatforms.length = 0;
}

export interface TestAccessory extends TestLog {
  accessory: MqttThingAccessory;
}

const openAccessories: MqttThingAccessory[] = [];

export function makeAccessory(config: Partial<ThingConfig>, api: API): TestAccessory {
  const { log, messages } = makeTestLog();
  const fullConfig = {
    accessory: 'mqttthing',
    name: 'Test Thing',
    ...config,
  } as ThingConfig;
  const accessory = new MqttThingAccessory(log as never, fullConfig as never, api);
  openAccessories.push(accessory);
  return { accessory, log, messages };
}

export function closeAccessories(): void {
  for (const accessory of openAccessories) {
    const ctx = (accessory as unknown as { ctx: { mqttClient?: { end(force: boolean): void } } | null }).ctx;
    ctx?.mqttClient?.end(true);
  }
  openAccessories.length = 0;
}
