// Working-copy operations spanning both configuration containers.
//
// Devices live either in the legacy accessories[] array (managed by
// homebridge-config-ui-x) or in the platform block's devices[] array (managed
// through this plugin's own server endpoints). The store keeps them in
// separate fields on purpose: the platform block must never be handed to
// updatePluginConfig(), which only knows about accessory blocks and drops
// everything it is not given.
//
// As in config-ops, every helper mutates the real configuration objects in
// place so unmodeled keys survive editing, and a device keeps its object
// identity when it moves between containers.
import type { ThingConfig } from '../../../src/config.js';
import { deepClone, duplicateName, mostCommonOfBrokers, type BrokerSettings } from './config-ops.js';
import { resolveEffectiveBroker } from '../../../src/model/broker-key.js';
import { identitySeed, isUuid, PLATFORM_ALIAS, type DeviceSource } from '../../../src/model/identity.js';
import { accessoryUuid, randomUuid } from './hap-uuid.js';

export type { DeviceSource };

export interface PlatformBlock {
  platform: string;
  name?: string;
  url?: string;
  username?: string;
  password?: string;
  mqttOptions?: Record<string, unknown>;
  devices: ThingConfig[];
  [key: string]: unknown;
}

export interface DeviceStore {
  legacy: ThingConfig[];
  platform: PlatformBlock | null;
}

export interface DeviceEntry {
  source: DeviceSource;
  config: ThingConfig;
}

/** Keys that identify a device; never carried over to a copy. */
const IDENTITY_KEYS = ['id', 'uuid_base'];

function asRecord(config: ThingConfig): Record<string, unknown> {
  return config as unknown as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The HomeKit accessory a configuration entry resolves to.
 *
 * A platform device whose id is already a UUID *is* that accessory; anything
 * else is a seed Homebridge hashes together with the accessory alias. An
 * accessory block has no id of its own - Homebridge identifies it by
 * uuid_base or name - so its source decides how it is read.
 */
export function identityUuid(config: ThingConfig, source: DeviceSource): string {
  const seed = identitySeed(config, source);
  if (isUuid(seed)) {
    return seed.toLowerCase();
  }
  // Hashing is by far the most expensive thing the views do, and they call
  // this for every device on every render (the working copy is mutated in
  // place, so nothing else can be memoized). Keyed by the seed, so a renamed
  // device is hashed again and a re-render with no change is free.
  const cached = uuidCache.get(config);
  if (cached !== undefined && cached.seed === seed) {
    return cached.uuid;
  }
  const uuid = accessoryUuid(seed);
  uuidCache.set(config, { seed, uuid });
  return uuid;
}

const uuidCache = new WeakMap<ThingConfig, { seed: string; uuid: string }>();

/** Identity for a newly created device: opaque, and unique by construction. */
export function newDeviceId(): string {
  return randomUuid();
}

/** The platform block, created (empty) when the configuration has none yet. */
export function ensurePlatformBlock(store: DeviceStore): PlatformBlock {
  if (store.platform === null) {
    store.platform = { platform: PLATFORM_ALIAS, devices: [] };
  } else if (!Array.isArray(store.platform.devices)) {
    store.platform.devices = [];
  }
  return store.platform;
}

/** Every device, legacy accessories first, in configuration order. */
export function allDevices(store: DeviceStore): DeviceEntry[] {
  const entries: DeviceEntry[] = store.legacy.map((config) => ({ source: 'accessory' as const, config }));
  for (const config of store.platform?.devices ?? []) {
    entries.push({ source: 'platform', config });
  }
  return entries;
}

export function deviceCounts(store: DeviceStore): { total: number; legacy: number; platform: number } {
  const legacy = store.legacy.length;
  const platform = store.platform?.devices?.length ?? 0;
  return { total: legacy + platform, legacy, platform };
}

export function sourceOf(store: DeviceStore, config: ThingConfig): DeviceSource | null {
  if (store.legacy.includes(config)) {
    return 'accessory';
  }
  if (store.platform?.devices?.includes(config)) {
    return 'platform';
  }
  return null;
}

export function containsDevice(store: DeviceStore, config: ThingConfig): boolean {
  return sourceOf(store, config) !== null;
}

function containerOf(store: DeviceStore, config: ThingConfig): ThingConfig[] | null {
  const source = sourceOf(store, config);
  if (source === 'accessory') {
    return store.legacy;
  }
  if (source === 'platform') {
    return store.platform!.devices;
  }
  return null;
}

/** Remove a device from whichever container holds it. */
export function removeDevice(store: DeviceStore, config: ThingConfig): boolean {
  const container = containerOf(store, config);
  if (!container) {
    return false;
  }
  container.splice(container.indexOf(config), 1);
  return true;
}

/**
 * Insert a copy of a device directly after it, in the same container, with a
 * collision-free name. The copy never inherits an identity: a duplicate is a
 * new device, not the same one twice.
 */
export function duplicateDevice(store: DeviceStore, config: ThingConfig): ThingConfig | null {
  const container = containerOf(store, config);
  if (!container) {
    return null;
  }
  const copy = deepClone(config);
  const record = asRecord(copy);
  for (const key of IDENTITY_KEYS) {
    delete record[key];
  }
  copy.name = duplicateName(
    allDevices(store).map((entry) => String(entry.config.name ?? '')),
    String(config.name ?? 'device'),
  );
  if (sourceOf(store, config) === 'platform') {
    copy.id = newDeviceId();
  }
  container.splice(container.indexOf(config) + 1, 0, copy);
  return copy;
}

/**
 * Which configuration formats are in use. The UI adapts to this rather than
 * to a stored preference: a user who never adopts platform mode never sees
 * anything about it beyond one entry point.
 */
export type ConfigShape = 'empty' | 'accessory' | 'platform' | 'mixed';

export function configShape(store: DeviceStore): ConfigShape {
  if (store.platform === null) {
    return store.legacy.length > 0 ? 'accessory' : 'empty';
  }
  return store.legacy.length > 0 ? 'mixed' : 'platform';
}

export type MoveEligibility = { movable: true } | { movable: false; reason: string };

/**
 * Whether an accessory can be moved into the platform block. Shared by the
 * migration preview and the move itself, so what the user is shown and what
 * happens can never disagree.
 */
export function moveEligibility(store: DeviceStore, config: ThingConfig): MoveEligibility {
  if (sourceOf(store, config) !== 'accessory') {
    return { movable: false, reason: 'it is not an accessory block' };
  }
  // Homebridge reads _bridge on accessory and platform blocks, but not on
  // individual platform devices. Moving such an accessory would silently
  // drop its child bridge, which is paired separately in HomeKit.
  if (config._bridge !== undefined) {
    return {
      movable: false,
      reason: 'it runs in its own child bridge, which platform mode cannot keep for a single device',
    };
  }
  if (stringValue(config.uuid_base) === undefined && String(config.name ?? '') === '') {
    return { movable: false, reason: 'it has no name' };
  }
  const uuid = identityUuid(config, 'accessory');
  const clash = (store.platform?.devices ?? []).find((device) => identityUuid(device, 'platform') === uuid);
  if (clash !== undefined) {
    return {
      movable: false,
      reason: `the platform device "${String(clash.name ?? '')}" is already the same HomeKit accessory`,
    };
  }
  return { movable: true };
}

/** Accessories that cannot be moved because they run in their own child bridge. */
export function childBridgeAccessories(store: DeviceStore): ThingConfig[] {
  return store.legacy.filter((config) => config._bridge !== undefined);
}

/**
 * MQTT connections before and after moving these accessories: accessory mode
 * opens one per accessory, platform mode one per distinct broker.
 */
export function connectionEstimate(configs: ThingConfig[]): { before: number; after: number } {
  // the runtime's own grouping rule, so the promise shown to the user is the
  // number of connections it will actually open
  const keys = new Set(configs.map((config) => resolveEffectiveBroker(config, {}, {}).key));
  return { before: configs.length, after: keys.size };
}

/** The one broker all of these share, or null when they differ. */
export function commonBrokerOf(configs: ThingConfig[]): BrokerSettings | null {
  if (configs.length === 0) {
    return null;
  }
  const first: BrokerSettings = {
    url: stringValue(configs[0].url),
    username: stringValue(configs[0].username),
    password: stringValue(configs[0].password),
  };
  if (first.url === undefined) {
    return null;
  }
  for (const config of configs) {
    if (
      stringValue(config.url) !== first.url ||
      stringValue(config.username) !== first.username ||
      stringValue(config.password) !== first.password
    ) {
      return null;
    }
  }
  return first;
}

/**
 * Make a broker the platform default and drop it from the given devices, so
 * one setting is not repeated on every entry.
 */
export function hoistBrokerToPlatform(
  store: DeviceStore,
  configs: ThingConfig[],
  broker: BrokerSettings,
): void {
  const block = ensurePlatformBlock(store);
  for (const key of ['url', 'username', 'password'] as const) {
    const value = broker[key];
    if (value === undefined) {
      delete block[key];
    } else {
      block[key] = value;
    }
    for (const config of configs) {
      delete asRecord(config)[key];
    }
  }
}

export type MigrateResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Move a legacy accessory into the platform block.
 *
 * The device's id is set to the HomeKit accessory it already is - the very
 * UUID Homebridge derived from its name (or uuid_base). Nothing is hashed
 * again afterwards, so the identity is unchanged and rooms, scenes and
 * automations survive, while the id carries no trace of a name that may
 * later change.
 *
 * Per-device broker settings are deliberately left in place even when they
 * match the platform defaults: removing them would silently re-point the
 * device if those defaults ever change.
 */
export function migrateDevice(store: DeviceStore, config: ThingConfig): MigrateResult {
  const eligibility = moveEligibility(store, config);
  if (!eligibility.movable) {
    return { ok: false, reason: eligibility.reason };
  }
  const id = identityUuid(config, 'accessory');

  const block = ensurePlatformBlock(store);
  store.legacy.splice(store.legacy.indexOf(config), 1);
  delete asRecord(config).accessory;
  config.id = id;
  block.devices.push(config);
  return { ok: true, id };
}

export interface MigrateAllResult {
  migrated: number;
  skipped: Array<{ name: string; reason: string }>;
}

/** Move exactly these accessories, in the order given. */
export function migrateSelected(store: DeviceStore, configs: ThingConfig[]): MigrateAllResult {
  const result: MigrateAllResult = { migrated: 0, skipped: [] };
  for (const config of [...configs]) {
    const outcome = migrateDevice(store, config);
    if (outcome.ok) {
      result.migrated++;
    } else {
      result.skipped.push({ name: String(config.name ?? ''), reason: outcome.reason });
    }
  }
  return result;
}

/**
 * The broker a device actually talks to: its own settings, falling back per
 * field to the platform defaults (platform devices only).
 */
export function effectiveBroker(store: DeviceStore, config: ThingConfig): BrokerSettings {
  const defaults = sourceOf(store, config) === 'platform' ? store.platform : null;
  const pick = (key: 'url' | 'username' | 'password'): string | undefined =>
    stringValue(config[key]) ?? (defaults ? stringValue(defaults[key]) : undefined);
  return { url: pick('url'), username: pick('username'), password: pick('password') };
}

/** The most common effective broker across both containers. */
export function mostCommonBrokerOf(store: DeviceStore): BrokerSettings | undefined {
  return mostCommonOfBrokers(allDevices(store).map((entry) => effectiveBroker(store, entry.config)));
}

/**
 * Copy one device's broker settings onto every other device. The platform
 * defaults are left alone: this is an explicit per-device action.
 */
export function applyBrokerToAllDevices(store: DeviceStore, source: ThingConfig): number {
  const broker = effectiveBroker(store, source);
  let changed = 0;
  for (const entry of allDevices(store)) {
    if (entry.config === source) {
      continue;
    }
    for (const key of ['url', 'username', 'password'] as const) {
      const value = broker[key];
      if (value === undefined) {
        delete asRecord(entry.config)[key];
      } else {
        entry.config[key] = value;
      }
    }
    changed++;
  }
  return changed;
}

/**
 * Devices configured in both containers. Homebridge publishes the legacy
 * accessory and silently skips the platform copy, so both cards get told.
 */
export function duplicateIdentityFindings(store: DeviceStore): Map<ThingConfig, string> {
  const findings = new Map<ThingConfig, string>();
  if (!store.platform) {
    return findings;
  }
  const legacyByUuid = new Map<string, ThingConfig>();
  for (const config of store.legacy) {
    legacyByUuid.set(identityUuid(config, 'accessory'), config);
  }
  for (const device of store.platform.devices ?? []) {
    const clash = legacyByUuid.get(identityUuid(device, 'platform'));
    if (clash) {
      findings.set(device, 'Also configured as a legacy accessory, which is the copy Homebridge publishes.');
      findings.set(clash, 'Also configured as a platform device, which Homebridge skips in favour of this one.');
    }
  }
  return findings;
}
