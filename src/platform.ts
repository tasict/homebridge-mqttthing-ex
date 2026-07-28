// Platform mode.
//
// A single "mqttthing" platform block holds a devices[] array using the same
// per-device configuration as accessory blocks. Compared to accessory mode it
// shares one MQTT connection per broker, keeps accessories in Homebridge's
// cache (so they appear before the broker is reachable) and gives each device
// a stable identity through its `id`.
//
// A device keeps its HomeKit identity when it moves here from accessories[]:
// the accessory UUID is generated from the same seed Homebridge uses in
// accessory mode, "mqttthing:" + (id || uuid_base || name).
import fs from 'node:fs';

import type {
  API,
  Categories,
  Controller,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import type { MqttThingPlatformConfig, ThingConfig } from './config.js';
import { applyAccessoryInformation, buildThingServices, publishStartPub } from './core/thing-builder.js';
import { makePrefixedLog, type Log } from './log.js';
import { initDeviceContext } from './mqtt/client.js';
import {
  closeConnection,
  openConnection,
  resolveEffectiveBroker,
  type BrokerSettings,
  type EffectiveBroker,
  type MqttConnection,
} from './mqtt/connection.js';
import type { MqttContext } from './mqtt/context.js';
import { validateThingConfig } from './model/validate.js';
import { ACCESSORY_NAME, getPluginVersion, PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

/** Diagnostics stored on the accessory, so a cached entry can be traced back. */
export interface MqttThingAccessoryContext {
  seed: string;
  id?: string;
  name: string;
  pluginVersion: string;
}

interface ParsedDevice {
  /** Device config with the accessory alias injected, as the builders expect. */
  config: ThingConfig;
  /** Value the accessory UUID is generated from. */
  seed: string;
  uuid: string;
  effective: EffectiveBroker;
  /** Platform log prefixed with the device name. */
  log: Log;
}

/**
 * Homebridge instantiates one platform per config block. Two "mqttthing"
 * blocks would share the accessory cache and unregister each other's
 * accessories, so only the first block of a Homebridge instance is active.
 */
const activePlatforms = new WeakMap<API, MqttThingPlatform>();

export class MqttThingPlatform implements DynamicPlatformPlugin {
  private readonly log: Log;
  private readonly config: MqttThingPlatformConfig;
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly connections = new Map<string, MqttConnection>();
  private readonly disabled: boolean;

  constructor(log: Logging, config: PlatformConfig, private readonly api: API) {
    this.log = log as unknown as Log;
    this.config = (config ?? {}) as unknown as MqttThingPlatformConfig;

    if (activePlatforms.has(api)) {
      this.log.error(
        `Only one "${PLATFORM_NAME}" platform block is supported - this one is ignored. ` +
          'Merge its devices into the first block.',
      );
      this.disabled = true;
      return;
    }
    activePlatforms.set(api, this);
    this.disabled = false;

    // Cached accessories are restored before this fires; all real work waits
    // for it so the diff sees the complete cache.
    api.on('didFinishLaunching', () => this.launch());
    api.on('shutdown', () => this.shutdown());
  }

  /** Called by Homebridge for every accessory restored from its cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    if (this.disabled) {
      return;
    }
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private launch(): void {
    const devices = this.parseDevices();
    this.warnLegacyCollisions(devices);

    // Anything cached but no longer configured. Devices that fail to build
    // stay registered on purpose: a temporary config mistake should not cost
    // their room, scene and automation assignments in HomeKit.
    const configured = new Set(devices.map((device) => device.uuid));
    const orphans = [...this.cachedAccessories.values()].filter((accessory) => !configured.has(accessory.UUID));

    this.openConnections(devices);

    const created: PlatformAccessory[] = [];
    const updated: PlatformAccessory[] = [];

    for (const device of devices) {
      const validation = validateThingConfig(device.config);
      for (const message of validation.errors) {
        device.log.error(message);
      }
      for (const message of validation.warnings) {
        device.log.warn(message);
      }

      const connection = this.connections.get(device.effective.key);
      if (!connection) {
        continue; // connection failed to open; the cached accessory is left alone
      }

      try {
        const built = this.buildDevice(device, connection);
        (built.isNew ? created : updated).push(built.accessory);
      } catch (ex) {
        device.log.error('Exception while creating services: ' + ex);
        device.log((ex as Error).stack ?? '');
      }
    }

    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
    }
    if (updated.length > 0) {
      this.api.updatePlatformAccessories(updated);
    }
    if (orphans.length > 0) {
      for (const accessory of orphans) {
        this.log(`Removing accessory no longer configured: ${accessory.displayName}`);
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphans);
      for (const accessory of orphans) {
        this.cachedAccessories.delete(accessory.UUID);
      }
    }

    this.log(
      `${devices.length} device(s) configured over ${this.connections.size} MQTT connection(s)` +
        ` (${created.length} added, ${updated.length} restored, ${orphans.length} removed)`,
    );
  }

  /** Validates devices[] and resolves each device's identity and broker. */
  private parseDevices(): ParsedDevice[] {
    const devices = this.config.devices;
    if (devices === undefined) {
      return [];
    }
    if (!Array.isArray(devices)) {
      this.log.error('"devices" must be an array - no devices configured.');
      return [];
    }

    const defaults: BrokerSettings = {
      url: this.config.url,
      username: this.config.username,
      password: this.config.password,
      mqttOptions: this.config.mqttOptions,
    };

    const parsed: ParsedDevice[] = [];
    const seenUuids = new Map<string, string>();

    devices.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        this.log.error(`devices[${index}] ignored - not a configuration object.`);
        return;
      }
      if (typeof entry.name !== 'string' || entry.name === '') {
        this.log.error(`devices[${index}] ignored - missing "name".`);
        return;
      }
      if (typeof entry.type !== 'string' || entry.type === '') {
        this.log.error(`devices[${index}] ("${entry.name}") ignored - missing "type".`);
        return;
      }

      const config = { ...entry, accessory: ACCESSORY_NAME } as ThingConfig;
      if (config._bridge !== undefined) {
        // Homebridge only honours _bridge on whole accessory or platform
        // blocks; here it would look configured but do nothing.
        this.log.warn(
          `devices[${index}] ("${config.name}") has a "_bridge" setting, which has no effect on a single ` +
            'platform device. Move the whole platform into a child bridge instead.',
        );
      }
      // An id that is already a UUID *is* the HomeKit accessory: that is what
      // moving a device from accessories[] writes, so the accessory it was
      // stays the accessory it is. Anything else is a seed, hashed exactly as
      // Homebridge hashes an accessory block's name.
      const seed = config.id || config.uuid_base || config.name;
      const uuid = this.api.hap.uuid.isValid(seed)
        ? seed.toLowerCase()
        : this.api.hap.uuid.generate(ACCESSORY_NAME + ':' + seed);

      const clash = seenUuids.get(uuid);
      if (clash !== undefined) {
        this.log.error(
          `devices[${index}] ("${config.name}") ignored - it has the same identity as "${clash}". ` +
            'Give one of them a different "id".',
        );
        return;
      }
      seenUuids.set(uuid, config.name);

      parsed.push({
        config,
        seed,
        uuid,
        effective: resolveEffectiveBroker(config, defaults),
        log: makePrefixedLog(this.log, `[${config.name}] `),
      });
    });

    return parsed;
  }

  /**
   * Warns when a device is also defined as a legacy accessory: Homebridge
   * publishes the accessory and silently skips the platform's copy.
   */
  private warnLegacyCollisions(devices: ParsedDevice[]): void {
    if (devices.length === 0) {
      return;
    }

    let accessories: unknown;
    try {
      const raw = fs.readFileSync(this.api.user.configPath(), 'utf8');
      accessories = (JSON.parse(raw) as { accessories?: unknown }).accessories;
    } catch {
      return; // best-effort diagnostic only
    }
    if (!Array.isArray(accessories)) {
      return;
    }

    const byUuid = new Map(devices.map((device) => [device.uuid, device]));
    for (const entry of accessories as Array<Record<string, unknown>>) {
      if (!entry || entry.accessory !== ACCESSORY_NAME) {
        continue;
      }
      const seed = (entry.uuid_base as string) || (entry.name as string);
      if (typeof seed !== 'string' || seed === '') {
        continue;
      }
      const clash = byUuid.get(this.api.hap.uuid.generate(ACCESSORY_NAME + ':' + seed));
      if (clash) {
        this.log.warn(
          `Device "${clash.config.name}" is also configured as an accessory in accessories[]. ` +
            'Homebridge keeps the accessory and skips the platform device - remove one of the two definitions.',
        );
      }
    }
  }

  /**
   * Opens one connection per distinct set of effective broker settings, so
   * devices sharing a broker share a connection.
   */
  private openConnections(devices: ParsedDevice[]): void {
    const groups = new Map<string, ParsedDevice[]>();
    for (const device of devices) {
      const group = groups.get(device.effective.key);
      if (group) {
        group.push(device);
      } else {
        groups.set(device.effective.key, [device]);
      }
    }

    const name = this.config.name || PLATFORM_NAME;
    for (const [key, members] of groups) {
      try {
        this.connections.set(
          key,
          openConnection(members[0].effective, {
            clientBase: name,
            willName: name,
            log: this.log,
            // logging is a property of the connection, so any member asking
            // for it turns it on for the whole group
            logMqtt: members.some((member) => !!member.config.logMqtt),
          }),
        );
      } catch (ex) {
        for (const member of members) {
          member.log.error('MQTT initialisation failed: ' + ex);
        }
      }
    }
  }

  private buildDevice(
    device: ParsedDevice,
    connection: MqttConnection,
  ): { accessory: PlatformAccessory; isNew: boolean } {
    const { config, seed, uuid, log } = device;
    const hap = this.api.hap;
    const category = this.categoryFor(config.type);

    const cached = this.cachedAccessories.get(uuid);
    const accessory = cached ?? new this.api.platformAccessory(config.name, uuid, category);
    const isNew = cached === undefined;

    if (cached) {
      if (cached.displayName !== config.name) {
        log(`Renamed from "${cached.displayName}" - its HomeKit identity is unchanged`);
        cached.updateDisplayName(config.name);
      }
      if (category !== undefined && cached.category !== category) {
        log('Accessory category changed - it may have to be removed and re-added in the Home app to show correctly');
        cached.category = category;
      }
      // Services are rebuilt from the current config. Iterate a copy:
      // removeService mutates the array being walked.
      for (const service of [...cached.services]) {
        if (service.UUID !== hap.Service.AccessoryInformation.UUID) {
          cached.removeService(service);
        }
      }
    }

    const context: MqttThingAccessoryContext = {
      seed,
      id: config.id,
      name: config.name,
      pluginVersion: getPluginVersion(),
    };
    accessory.context.mqttthing = context;

    const information = accessory.getService(hap.Service.AccessoryInformation);
    if (information) {
      applyAccessoryInformation(information, hap, config);
    }

    // One context per device, sharing the group's client and topic dispatch by
    // reference: a topic several devices listen to is subscribed once and
    // dispatched to all of them, while codec/state stay per device.
    const ctx: MqttContext = {
      log,
      config,
      homebridgePath: this.api.user.storagePath(),
      mqttDispatch: connection.dispatch,
      propDispatch: {},
      state: {},
      mqttClient: connection.client,
    };
    initDeviceContext(ctx);

    const controllers: Controller[] = [];
    const throttledCallTimers: Record<string, NodeJS.Timeout | null> = {};
    const services = buildThingServices({
      ctx,
      config,
      log,
      api: this.api,
      controllers,
      throttledCallTimers,
    });

    if (services) {
      for (const service of services) {
        accessory.addService(service);
      }
    }

    for (const controller of controllers) {
      accessory.configureController(controller);
    }

    publishStartPub(ctx, config);

    return { accessory, isNew };
  }

  /**
   * HomeKit category. Accessory mode gets this from Homebridge; here only
   * televisions need one, the rest are fine as the default.
   */
  private categoryFor(type: string): Categories | undefined {
    return type.split('-')[0] === 'television' ? this.api.hap.Categories.TELEVISION : undefined;
  }

  private shutdown(): void {
    for (const connection of this.connections.values()) {
      closeConnection(connection);
    }
    this.connections.clear();
  }
}
