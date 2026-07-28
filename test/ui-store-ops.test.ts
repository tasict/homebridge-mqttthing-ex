// Unit tests for the dual-container working-copy operations used by the
// custom UI (ui/src/lib/store-ops.ts).
import { describe, expect, it } from 'vitest';

import type { ThingConfig } from '../src/config.js';
import { parsePlatformDeviceJson } from '../ui/src/lib/config-ops.js';
import {
  allDevices,
  applyBrokerToAllDevices,
  childBridgeAccessories,
  commonBrokerOf,
  configShape,
  connectionEstimate,
  deviceCounts,
  duplicateDevice,
  duplicateIdentityFindings,
  effectiveBroker,
  ensurePlatformBlock,
  fnv1a64,
  hoistBrokerToPlatform,
  migrateDevice,
  migrateSelected,
  mostCommonBrokerOf,
  moveEligibility,
  newDeviceId,
  removeDevice,
  seedOf,
  sourceOf,
  type DeviceStore,
  type PlatformBlock,
} from '../ui/src/lib/store-ops.js';

function accessory(name: string, extra: Partial<ThingConfig> = {}): ThingConfig {
  return { accessory: 'mqttthing', type: 'switch', name, ...extra } as ThingConfig;
}

function device(name: string, extra: Partial<ThingConfig> = {}): ThingConfig {
  return { type: 'switch', name, ...extra } as unknown as ThingConfig;
}

function store(legacy: ThingConfig[] = [], platform: Partial<PlatformBlock> | null = null): DeviceStore {
  return {
    legacy,
    platform: platform === null ? null : ({ platform: 'mqttthing', devices: [], ...platform } as PlatformBlock),
  };
}

describe('store shape', () => {
  it('creates a canonical platform block on demand and is idempotent', () => {
    const s = store();
    const block = ensurePlatformBlock(s);
    expect(block).toEqual({ platform: 'mqttthing', devices: [] });
    expect(ensurePlatformBlock(s)).toBe(block);
  });

  it('repairs a platform block whose devices array is missing', () => {
    const s = store([], { devices: undefined as never });
    expect(ensurePlatformBlock(s).devices).toEqual([]);
  });

  it('lists legacy accessories before platform devices', () => {
    const s = store([accessory('A')], { devices: [device('B')] });
    expect(allDevices(s).map((e) => [e.source, e.config.name])).toEqual([
      ['accessory', 'A'],
      ['platform', 'B'],
    ]);
    expect(deviceCounts(s)).toEqual({ total: 2, legacy: 1, platform: 1 });
  });

  it('reports which container a device belongs to', () => {
    const a = accessory('A');
    const b = device('B');
    const s = store([a], { devices: [b] });
    expect(sourceOf(s, a)).toBe('accessory');
    expect(sourceOf(s, b)).toBe('platform');
    expect(sourceOf(s, accessory('elsewhere'))).toBeNull();
  });

  it('removes a device from whichever container holds it', () => {
    const a = accessory('A');
    const b = device('B');
    const s = store([a], { devices: [b] });
    expect(removeDevice(s, b)).toBe(true);
    expect(s.platform!.devices).toEqual([]);
    expect(removeDevice(s, a)).toBe(true);
    expect(s.legacy).toEqual([]);
    expect(removeDevice(s, a)).toBe(false);
  });
});

describe('identity', () => {
  it('derives the UUID seed like the runtime does', () => {
    expect(seedOf(device('Name'))).toBe('Name');
    expect(seedOf(device('Name', { uuid_base: 'Base' }))).toBe('Base');
    expect(seedOf(device('Name', { uuid_base: 'Base', id: 'Id' }))).toBe('Id');
  });

  it('hashes names to a stable 16-digit id', () => {
    expect(fnv1a64('Living Room Light')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('Living Room Light')).toBe(fnv1a64('Living Room Light'));
    expect(fnv1a64('a')).not.toBe(fnv1a64('b'));
  });

  it('hashes non-ASCII names without trouble', () => {
    expect(fnv1a64('客廳燈')).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64('客廳燈')).not.toBe(fnv1a64('臥室燈'));
  });

  it('re-hashes until the id is unused', () => {
    const taken = fnv1a64('Switch');
    expect(newDeviceId('Switch', [])).toBe(taken);
    expect(newDeviceId('Switch', [taken])).toBe(fnv1a64(taken));
    expect(newDeviceId('Switch', [taken, fnv1a64(taken)])).toBe(fnv1a64(fnv1a64(taken)));
  });
});

describe('duplication', () => {
  it('inserts an independent copy after the original without its identity', () => {
    const original = device('Lamp', { id: 'abc', uuid_base: 'base', topics: { getOn: 't' } });
    const s = store([], { devices: [original, device('Other')] });

    const copy = duplicateDevice(s, original)!;
    expect(s.platform!.devices.map((d) => d.name)).toEqual(['Lamp', 'Lamp copy', 'Other']);
    expect(copy.uuid_base).toBeUndefined();
    expect(copy.id).not.toBe('abc');
    expect(copy.id).toBe(fnv1a64('Lamp copy'));
    (copy.topics as Record<string, string>).getOn = 'changed';
    expect((original.topics as Record<string, string>).getOn).toBe('t');
  });

  it('keeps a legacy duplicate in the legacy container and gives it no id', () => {
    const original = accessory('Lamp', { uuid_base: 'base' });
    const s = store([original], { devices: [device('Lamp copy')] });

    const copy = duplicateDevice(s, original)!;
    expect(s.legacy).toHaveLength(2);
    expect(copy.id).toBeUndefined();
    expect(copy.uuid_base).toBeUndefined();
    // names are unique across both containers
    expect(copy.name).toBe('Lamp copy 2');
  });
});

describe('migration', () => {
  it('moves the device object itself and pins its identity to the name', () => {
    const config = accessory('Living Room', { url: 'mqtt://a' });
    const s = store([config]);

    const result = migrateDevice(s, config);
    expect(result).toEqual({ ok: true, id: 'Living Room' });
    expect(s.legacy).toEqual([]);
    expect(s.platform!.devices[0]).toBe(config); // same object: an open editor survives
    expect(config.id).toBe('Living Room');
    expect((config as Record<string, unknown>).accessory).toBeUndefined();
    // per-device broker settings stay put
    expect(config.url).toBe('mqtt://a');
  });

  it('pins the identity to uuid_base when one is configured', () => {
    const config = accessory('Renamed', { uuid_base: 'Original' });
    const s = store([config]);
    expect(migrateDevice(s, config)).toEqual({ ok: true, id: 'Original' });
    expect(config.id).toBe('Original');
  });

  it('refuses when a platform device already has that identity', () => {
    const config = accessory('Lamp');
    const s = store([config], { devices: [device('Lamp')] });

    const result = migrateDevice(s, config);
    expect(result.ok).toBe(false);
    expect(s.legacy).toHaveLength(1);
    expect(!result.ok && result.reason).toContain('already exists');
  });

  it('refuses an accessory running in its own child bridge', () => {
    const config = accessory('Bridged', { _bridge: { username: '0E:11:22:33:44:55', port: 51888 } });
    const s = store([config]);

    const result = migrateDevice(s, config);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('child bridge');
    expect(s.legacy).toEqual([config]);
    expect(s.platform).toBeNull();
  });

  it('refuses a device that is not a legacy accessory', () => {
    const config = device('Lamp');
    const s = store([], { devices: [config] });
    expect(migrateDevice(s, config).ok).toBe(false);
  });

  it('migrates the selected accessories and reports what it skipped', () => {
    const ok1 = accessory('A');
    const clash = accessory('B');
    const ok2 = accessory('C');
    const s = store([ok1, clash, ok2], { devices: [device('B')] });

    const result = migrateSelected(s, [...s.legacy]);
    expect(result.migrated).toBe(2);
    expect(result.skipped).toEqual([{ name: 'B', reason: expect.stringContaining('already exists') }]);
    expect(s.legacy).toEqual([clash]);
    expect(s.platform!.devices.map((d) => d.name)).toEqual(['B', 'A', 'C']);
  });

  it('leaves accessories that were not selected alone', () => {
    const chosen = accessory('A');
    const untouched = accessory('B');
    const s = store([chosen, untouched]);

    expect(migrateSelected(s, [chosen]).migrated).toBe(1);
    expect(s.legacy).toEqual([untouched]);
    expect(s.platform!.devices.map((d) => d.name)).toEqual(['A']);
  });
});

describe('configuration shape', () => {
  it('reflects which formats are in use', () => {
    expect(configShape(store())).toBe('empty');
    expect(configShape(store([accessory('A')]))).toBe('accessory');
    expect(configShape(store([], { devices: [device('B')] }))).toBe('platform');
    expect(configShape(store([accessory('A')], { devices: [device('B')] }))).toBe('mixed');
  });

  it('counts an empty platform block as platform mode', () => {
    // the block exists in config.json, so its settings must stay reachable
    expect(configShape(store([], { devices: [] }))).toBe('platform');
  });
});

describe('move eligibility', () => {
  it('accepts a plain accessory', () => {
    const config = accessory('A');
    expect(moveEligibility(store([config]), config)).toEqual({ movable: true });
  });

  it('rejects an accessory in its own child bridge and lists it', () => {
    const config = accessory('A', { _bridge: { username: '0E:11:22:33:44:55' } });
    const s = store([config, accessory('B')]);
    const result = moveEligibility(s, config);
    expect(result.movable).toBe(false);
    expect(!result.movable && result.reason).toContain('child bridge');
    expect(childBridgeAccessories(s)).toEqual([config]);
  });

  it('rejects an identity that a platform device already uses', () => {
    const config = accessory('A');
    const result = moveEligibility(store([config], { devices: [device('A')] }), config);
    expect(result.movable).toBe(false);
    expect(!result.movable && result.reason).toContain('already exists');
  });

  it('agrees with what migrateDevice does', () => {
    const config = accessory('A', { _bridge: {} });
    const s = store([config]);
    expect(migrateDevice(s, config)).toEqual({
      ok: false,
      reason: (moveEligibility(s, config) as { reason: string }).reason,
    });
  });
});

describe('connection estimate', () => {
  it('counts one connection per accessory and one per distinct broker', () => {
    const configs = [
      accessory('A', { url: 'mqtt://one' }),
      accessory('B', { url: 'mqtt://one' }),
      accessory('C', { url: 'mqtt://two' }),
    ];
    expect(connectionEstimate(configs)).toEqual({ before: 3, after: 2 });
  });

  it('separates brokers that differ only by credentials', () => {
    const configs = [
      accessory('A', { url: 'mqtt://one', username: 'u' }),
      accessory('B', { url: 'mqtt://one' }),
    ];
    expect(connectionEstimate(configs)).toEqual({ before: 2, after: 2 });
  });
});

describe('hoisting a shared broker', () => {
  it('finds the broker only when every accessory agrees', () => {
    const same = [accessory('A', { url: 'mqtt://one', username: 'u' }), accessory('B', { url: 'mqtt://one', username: 'u' })];
    expect(commonBrokerOf(same)).toEqual({ url: 'mqtt://one', username: 'u', password: undefined });
    expect(commonBrokerOf([...same, accessory('C', { url: 'mqtt://two' })])).toBeNull();
    expect(commonBrokerOf([accessory('D')])).toBeNull();
    expect(commonBrokerOf([])).toBeNull();
  });

  it('moves the broker onto the block and off the devices', () => {
    const a = device('A', { url: 'mqtt://one', username: 'u' });
    const b = device('B', { url: 'mqtt://one', username: 'u' });
    const s = store([], { devices: [a, b] });

    hoistBrokerToPlatform(s, [a, b], { url: 'mqtt://one', username: 'u' });

    expect(s.platform!.url).toBe('mqtt://one');
    expect(s.platform!.username).toBe('u');
    expect(s.platform!.password).toBeUndefined();
    expect(a.url).toBeUndefined();
    expect(b.username).toBeUndefined();
    // the devices still resolve to the same broker through the defaults
    expect(effectiveBroker(s, a)).toEqual({ url: 'mqtt://one', username: 'u', password: undefined });
  });
});

describe('broker resolution', () => {
  it('falls back to the platform defaults field by field', () => {
    const own = device('Own', { url: 'mqtt://own' });
    const inherited = device('Inherited');
    const s = store([], {
      url: 'mqtt://platform',
      username: 'pu',
      password: 'pp',
      devices: [own, inherited],
    });

    expect(effectiveBroker(s, own)).toEqual({ url: 'mqtt://own', username: 'pu', password: 'pp' });
    expect(effectiveBroker(s, inherited)).toEqual({ url: 'mqtt://platform', username: 'pu', password: 'pp' });
  });

  it('never applies platform defaults to a legacy accessory', () => {
    const legacy = accessory('Legacy');
    const s = store([legacy], { url: 'mqtt://platform', devices: [] });
    expect(effectiveBroker(s, legacy)).toEqual({ url: undefined, username: undefined, password: undefined });
  });

  it('counts effective brokers across both containers', () => {
    const s = store([accessory('A', { url: 'mqtt://x' })], {
      url: 'mqtt://y',
      devices: [device('B'), device('C')],
    });
    expect(mostCommonBrokerOf(s)).toEqual({ url: 'mqtt://y' });
  });

  it('applies one broker to every other device, leaving platform defaults alone', () => {
    const source = accessory('Source', { url: 'mqtt://new', username: 'nu' });
    const legacy = accessory('Other', { url: 'mqtt://old', password: 'gone' });
    const platformDevice = device('Device', { url: 'mqtt://old' });
    const s = store([source, legacy], { url: 'mqtt://platform', devices: [platformDevice] });

    expect(applyBrokerToAllDevices(s, source)).toBe(2);
    expect(legacy.url).toBe('mqtt://new');
    expect(legacy.username).toBe('nu');
    expect(legacy.password).toBeUndefined();
    expect(platformDevice.url).toBe('mqtt://new');
    expect(s.platform!.url).toBe('mqtt://platform');
    expect(source.url).toBe('mqtt://new');
  });
});

describe('duplicate identity findings', () => {
  it('flags both copies when a device is configured twice', () => {
    const legacy = accessory('Lamp');
    const platformDevice = device('Renamed', { id: 'Lamp' });
    const s = store([legacy, accessory('Fine')], { devices: [platformDevice] });

    const findings = duplicateIdentityFindings(s);
    expect(findings.get(legacy)).toContain('platform device');
    expect(findings.get(platformDevice)).toContain('legacy accessory');
    expect(findings.size).toBe(2);
  });

  it('finds nothing without a platform block', () => {
    expect(duplicateIdentityFindings(store([accessory('A')])).size).toBe(0);
  });
});

describe('parsePlatformDeviceJson', () => {
  it('strips the accessory alias', () => {
    const result = parsePlatformDeviceJson('{"accessory":"mqttthing","name":"A","type":"switch"}', 'keep');
    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({ name: 'A', type: 'switch', id: 'keep' });
  });

  it('restores the current id when the text omits it', () => {
    const result = parsePlatformDeviceJson('{"name":"A","type":"switch"}', 'keep');
    expect(result.config!.id).toBe('keep');
    expect(result.idChanged).toBe(false);
  });

  it('reports a changed id so the UI can warn', () => {
    const result = parsePlatformDeviceJson('{"name":"A","type":"switch","id":"other"}', 'keep');
    expect(result.idChanged).toBe(true);
    expect(result.config!.id).toBe('other');
  });

  it('rejects an empty or non-string id', () => {
    expect(parsePlatformDeviceJson('{"name":"A","type":"switch","id":""}', 'k').error).toContain('non-empty string');
    expect(parsePlatformDeviceJson('{"name":"A","type":"switch","id":5}', 'k').error).toContain('non-empty string');
  });

  it('applies the same name and type rules as the accessory form', () => {
    expect(parsePlatformDeviceJson('{"type":"switch"}', 'k').error).toContain('"name"');
    expect(parsePlatformDeviceJson('{"name":"A"}', 'k').error).toContain('"type"');
    expect(parsePlatformDeviceJson('not json', 'k').error).toContain('Invalid JSON');
  });

  it('leaves the id out entirely for a device that has none yet', () => {
    const result = parsePlatformDeviceJson('{"name":"A","type":"switch"}', undefined);
    expect(result.config).toEqual({ name: 'A', type: 'switch' });
  });
});
