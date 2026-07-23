import * as hapNodeJs from '@homebridge/hap-nodejs';
import type { API } from 'homebridge';

import type { ThingConfig } from '../src/config.js';
import { MqttThingAccessory } from '../src/accessory.js';
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
