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

export type DeviceSource = 'accessory' | 'platform';

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
 * What the accessory UUID is generated from: "mqttthing:" + this. Mirrors the
 * runtime (and Homebridge's own accessory-mode formula), so two devices with
 * the same seed would be the same HomeKit accessory.
 */
export function seedOf(config: ThingConfig): string {
  return stringValue(config.id) ?? stringValue(config.uuid_base) ?? String(config.name ?? '');
}

/**
 * 64-bit FNV-1a as 16 hex digits. Synchronous by design: crypto.subtle is
 * unavailable when the Homebridge UI is served over plain HTTP.
 */
export function fnv1a64(input: string): string {
  const mask = (1n << 64n) - 1n;
  let hash = 14695981039346656037n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 1099511628211n) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Identity for a newly created device: a hash of its name, so the id carries
 * no trace of a name that may later change. Re-hashed until unique.
 */
export function newDeviceId(name: string, existingIds: Iterable<string>): string {
  const used = new Set(existingIds);
  let id = fnv1a64(name);
  while (used.has(id)) {
    id = fnv1a64(id);
  }
  return id;
}

/** The platform block, created (empty) when the configuration has none yet. */
export function ensurePlatformBlock(store: DeviceStore): PlatformBlock {
  if (store.platform === null) {
    store.platform = { platform: 'mqttthing', devices: [] };
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
    copy.id = newDeviceId(String(copy.name), platformIds(store));
  }
  container.splice(container.indexOf(config) + 1, 0, copy);
  return copy;
}

function platformIds(store: DeviceStore): string[] {
  return (store.platform?.devices ?? []).map((device) => seedOf(device));
}

export type MigrateResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Move a legacy accessory into the platform block.
 *
 * The device's id is pinned to what its HomeKit UUID is generated from today
 * (uuid_base if set, otherwise the name), copied verbatim - the UUID stays
 * identical, so rooms, scenes and automations survive. Renaming afterwards is
 * then free.
 *
 * Per-device broker settings are deliberately left in place even when they
 * match the platform defaults: removing them would silently re-point the
 * device if those defaults ever change.
 */
export function migrateDevice(store: DeviceStore, config: ThingConfig): MigrateResult {
  if (sourceOf(store, config) !== 'accessory') {
    return { ok: false, reason: 'it is not a legacy accessory' };
  }
  const id = stringValue(config.uuid_base) ?? String(config.name ?? '');
  if (id === '') {
    return { ok: false, reason: 'it has no name' };
  }

  const block = ensurePlatformBlock(store);
  if (block.devices.some((device) => seedOf(device) === id)) {
    return { ok: false, reason: `a platform device with the identity "${id}" already exists` };
  }

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

export function migrateAll(store: DeviceStore): MigrateAllResult {
  const result: MigrateAllResult = { migrated: 0, skipped: [] };
  for (const config of [...store.legacy]) {
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
  const legacyBySeed = new Map<string, ThingConfig>();
  for (const config of store.legacy) {
    legacyBySeed.set(seedOf(config), config);
  }
  for (const device of store.platform.devices ?? []) {
    const clash = legacyBySeed.get(seedOf(device));
    if (clash) {
      findings.set(device, 'Also configured as a legacy accessory, which is the copy Homebridge publishes.');
      findings.set(clash, 'Also configured as a platform device, which Homebridge skips in favour of this one.');
    }
  }
  return findings;
}
