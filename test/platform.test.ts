import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import { afterAll, describe, expect, it } from 'vitest';

import { MqttThingPlatform } from '../src/platform.js';
import { closePlatforms, makePlatform, makePlatformApi } from './hap-helpers.js';
import { makeTestLog } from './helpers.js';

const { Categories, Characteristic, Service } = hapNodeJs;

// Devices in these tests do not need a reachable broker; disabling reconnects
// keeps a failed connection from retrying in the background.
const quiet = { reconnectPeriod: 0 };

function uuidOf(seed: string): string {
  return hapNodeJs.uuid.generate('mqttthing:' + seed);
}

function harness(configPath?: string) {
  return makePlatformApi(os.tmpdir(), configPath);
}

afterAll(() => {
  closePlatforms();
});

describe('MqttThingPlatform lifecycle', () => {
  it('does no work before didFinishLaunching', () => {
    const h = harness();
    const { log } = makeTestLog();
    const platform = new MqttThingPlatform(
      log as never,
      { platform: 'mqttthing', mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] } as never,
      h.api,
    );
    expect(platform).toBeInstanceOf(MqttThingPlatform);
    expect(h.registered).toHaveLength(0);

    h.finishLaunching();
    expect(h.registered).toHaveLength(1);
    h.shutdown();
  });

  it('ignores a second mqttthing platform block', () => {
    const h = harness();
    const emitter = h.api as unknown as { listenerCount(event: string): number };
    makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] }, h);
    const listenersAfterFirst = emitter.listenerCount('didFinishLaunching');

    const { log, messages } = makeTestLog();
    const second = new MqttThingPlatform(
      log as never,
      { platform: 'mqttthing', mqttOptions: quiet, devices: [{ name: 'Sw2', type: 'switch' }] } as never,
      h.api,
    );

    expect(messages.join('\n')).toContain('Only one "mqttthing" platform block is supported');
    // it never launches, so it can neither publish nor unregister anything
    expect(emitter.listenerCount('didFinishLaunching')).toBe(listenersAfterFirst);
    second.configureAccessory(h.makeCachedAccessory('Sw2', uuidOf('Sw2')));
    expect(h.registered).toHaveLength(1);
  });

  it('tolerates a block without devices', () => {
    const h = harness();
    const { messages } = makePlatform({ mqttOptions: quiet }, h);
    expect(h.registered).toHaveLength(0);
    expect(messages.join('\n')).toContain('0 device(s) configured');
  });
});

describe('MqttThingPlatform identity', () => {
  it('generates the accessory UUID from the name, matching accessory mode', () => {
    const h = harness();
    makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] }, h);
    expect(h.registered[0].UUID).toBe(uuidOf('Sw1'));
  });

  it('prefers uuid_base over the name', () => {
    const h = harness();
    makePlatform({ mqttOptions: quiet, devices: [{ name: 'Renamed', type: 'switch', uuid_base: 'Original' }] }, h);
    expect(h.registered[0].UUID).toBe(uuidOf('Original'));
  });

  it('prefers id over uuid_base and the name', () => {
    const h = harness();
    makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'Renamed', type: 'switch', uuid_base: 'Original', id: 'stable' }] },
      h,
    );
    expect(h.registered[0].UUID).toBe(uuidOf('stable'));
  });

  it('records the identity in the accessory context', () => {
    const h = harness();
    makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch', id: 'abc123' }] }, h);
    expect(h.registered[0].context.mqttthing).toMatchObject({ seed: 'abc123', id: 'abc123', name: 'Sw1' });
  });

  it('skips a device whose identity collides with an earlier one', () => {
    const h = harness();
    const { messages } = makePlatform(
      {
        mqttOptions: quiet,
        devices: [
          { name: 'Sw1', type: 'switch' },
          { name: 'Sw1', type: 'switch' },
        ],
      },
      h,
    );
    expect(h.registered).toHaveLength(1);
    expect(messages.join('\n')).toContain('same identity');
  });

  it('skips entries missing a name or type', () => {
    const h = harness();
    const { messages } = makePlatform(
      { mqttOptions: quiet, devices: [{ type: 'switch' }, { name: 'NoType' }, { name: 'Sw1', type: 'switch' }] },
      h,
    );
    expect(h.registered).toHaveLength(1);
    const text = messages.join('\n');
    expect(text).toContain('devices[0] ignored - missing "name"');
    expect(text).toContain('devices[1] ("NoType") ignored - missing "type"');
  });
});

describe('MqttThingPlatform services', () => {
  it('reuses the accessory information service Homebridge already created', () => {
    const h = harness();
    makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch', manufacturer: 'ACME', model: 'X1' }] },
      h,
    );
    const accessory = h.registered[0];
    const information = accessory.services.filter((s) => s.UUID === Service.AccessoryInformation.UUID);
    expect(information).toHaveLength(1);
    expect(information[0].getCharacteristic(Characteristic.Manufacturer).value).toBe('ACME');
    expect(information[0].getCharacteristic(Characteristic.Model).value).toBe('X1');
    expect(information[0].getCharacteristic(Characteristic.SerialNumber).value).toBe(os.hostname() + '-Sw1');
  });

  it('builds the configured service', () => {
    const h = harness();
    makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch', topics: { setOn: 'a/set', getOn: 'a/get' } }] },
      h,
    );
    const accessory = h.registered[0];
    expect(accessory.getService(Service.Switch)).toBeDefined();
    expect(accessory.services).toHaveLength(2); // information + switch
  });

  it('expands a custom multi-service device', () => {
    const h = harness();
    makePlatform(
      {
        mqttOptions: quiet,
        devices: [
          {
            name: 'Combo',
            type: 'custom',
            services: [
              { name: 'ComboSwitch', type: 'switch', topics: { setOn: 'c/set', getOn: 'c/get' } },
              { name: 'ComboLight', type: 'lightbulb', topics: { setOn: 'l/set', getOn: 'l/get' } },
            ],
          },
        ],
      },
      h,
    );
    const accessory = h.registered[0];
    expect(accessory.services).toHaveLength(3); // information + switch + lightbulb
  });

  it('sets the television category', () => {
    const h = harness();
    makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'TV1', type: 'television', topics: { setActive: 't/set', getActive: 't/get' } }] },
      h,
    );
    expect(h.registered[0].category).toBe(Categories.TELEVISION);
  });

  it('leaves other devices at the default category', () => {
    const h = harness();
    makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] }, h);
    expect(h.registered[0].category).toBe(Categories.OTHER);
  });

  it('keeps the accessory registered when its type is unknown', () => {
    const h = harness();
    const { messages } = makePlatform({ mqttOptions: quiet, devices: [{ name: 'Odd', type: 'notAType' }] }, h);
    expect(h.registered).toHaveLength(1);
    expect(h.registered[0].services).toHaveLength(1); // information only
    expect(messages.join('\n')).toContain('Unrecognized type');
  });
});

describe('MqttThingPlatform cache handling', () => {
  it('restores a cached accessory instead of registering it again', () => {
    const h = harness();
    const cached = h.makeCachedAccessory('Sw1', uuidOf('Sw1'));
    cached.addService(new Service.Switch('Stale', 'stale-subtype'));

    makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch', topics: { getOn: 'a/get' } }] },
      h,
      [cached],
    );

    expect(h.registered).toHaveLength(0);
    expect(h.updated).toHaveLength(1);
    expect(h.updated[0]).toBe(cached);
    // the stale service was wiped and rebuilt from the current config
    expect(cached.getServiceById(Service.Switch, 'stale-subtype')).toBeUndefined();
    expect(cached.services).toHaveLength(2);
  });

  it('keeps the UUID when a device is renamed', () => {
    const h = harness();
    const cached = h.makeCachedAccessory('Old Name', uuidOf('keepme'));

    const { messages } = makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'New Name', type: 'switch', id: 'keepme' }] },
      h,
      [cached],
    );

    expect(h.registered).toHaveLength(0);
    expect(cached.displayName).toBe('New Name');
    expect(cached.UUID).toBe(uuidOf('keepme'));
    expect(messages.join('\n')).toContain('Renamed from "Old Name"');
  });

  it('unregisters accessories that are no longer configured', () => {
    const h = harness();
    const gone = h.makeCachedAccessory('Gone', uuidOf('Gone'));
    const kept = h.makeCachedAccessory('Sw1', uuidOf('Sw1'));

    const { messages } = makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] }, h, [
      gone,
      kept,
    ]);

    expect(h.unregistered).toHaveLength(1);
    expect(h.unregistered[0]).toBe(gone);
    expect(messages.join('\n')).toContain('Removing accessory no longer configured: Gone');
  });

  it('unregisters everything when devices is emptied', () => {
    const h = harness();
    const cached = h.makeCachedAccessory('Sw1', uuidOf('Sw1'));
    makePlatform({ mqttOptions: quiet, devices: [] }, h, [cached]);
    expect(h.unregistered).toEqual([cached]);
  });
});

describe('MqttThingPlatform diagnostics', () => {
  it('warns about configuration problems but still builds the device', () => {
    const h = harness();
    const { messages } = makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch', topics: { setOn: 'a/set' }, optimizePublishng: true }] },
      h,
    );
    expect(h.registered).toHaveLength(1);
    expect(messages.join('\n')).toContain('optimizePublishing');
  });

  it('does not warn about the id field', () => {
    const h = harness();
    const { messages } = makePlatform(
      { mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch', id: 'abc', topics: { getOn: 'a/get' } }] },
      h,
    );
    expect(messages.join('\n')).not.toContain('id');
  });

  it('warns when a device is also configured as a legacy accessory', () => {
    const configPath = path.join(os.tmpdir(), `mqttthing-platform-test-${process.pid}.json`);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ accessories: [{ accessory: 'mqttthing', name: 'Sw1', type: 'switch' }] }),
    );
    try {
      const h = harness(configPath);
      const { messages } = makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] }, h);
      expect(messages.join('\n')).toContain('also configured as an accessory in accessories[]');
    } finally {
      fs.unlinkSync(configPath);
    }
  });

  it('stays quiet when config.json cannot be read', () => {
    const h = harness(path.join(os.tmpdir(), 'definitely-not-here.json'));
    const { messages } = makePlatform({ mqttOptions: quiet, devices: [{ name: 'Sw1', type: 'switch' }] }, h);
    expect(messages.join('\n')).not.toContain('accessories[]');
  });
});
