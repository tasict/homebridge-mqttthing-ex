// Shared MQTT connections for platform mode.
//
// Accessory mode opens one connection per accessory. In platform mode the
// devices of a platform block usually talk to the same broker with the same
// credentials, so they are grouped by their *effective* broker settings and
// each group gets a single connection. Devices that override the broker (or
// its credentials/options) end up in their own group automatically.
import type { MqttClient } from 'mqtt';

import type { Log } from '../log.js';
import { assembleBrokerOptions, createDispatchingClient, makeClientId } from './client.js';
import type { MessageHandler } from './context.js';

/** Broker settings as given by a device config or a platform block. */
export interface BrokerSettings {
  url?: string;
  username?: string;
  password?: string;
  mqttOptions?: Record<string, unknown>;
}

export interface EffectiveBroker {
  /** Broker URL after defaults and protocol normalization. */
  url: string;
  username?: string;
  password?: string;
  /** The chosen options object: a device's replaces the platform's entirely. */
  mqttOptions: Record<string, unknown>;
  /** Pool key - devices with an equal key share one connection. */
  key: string;
}

export interface MqttConnection {
  key: string;
  url: string;
  client: MqttClient;
  /** Topic -> handlers, shared by every device on this connection. */
  dispatch: Record<string, MessageHandler[]>;
  logMqtt: boolean;
}

export interface OpenConnectionOptions {
  /** Base for the generated client id, normally the platform block's name. */
  clientBase: string;
  /** Name used in the default last-will payload. */
  willName: string;
  log: Log;
  /** True when any device on this connection has logMqtt enabled. */
  logMqtt: boolean;
}

/** JSON with object keys sorted at every level, so key order cannot split a group. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(obj[key]))
      .join(',') +
    '}'
  );
}

/**
 * Resolves a device's broker settings against the platform defaults and
 * computes its connection pool key.
 *
 * Resolution follows the same truthiness rules the accessory path uses, and
 * the URL is normalized before keying so "host:1883" and "mqtt://host:1883"
 * group together. `mqttOptions` is replaced, never deep-merged: merging would
 * invent semantics no existing config ever had.
 *
 * The key includes the password, so it must never be logged.
 */
export function resolveEffectiveBroker(
  device: BrokerSettings,
  defaults: BrokerSettings,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveBroker {
  let url = device.url || defaults.url || env.MQTTTHING_URL || 'mqtt://localhost:1883';
  if (!url.includes('://')) {
    url = 'mqtt://' + url;
  }
  const username = device.username || defaults.username || env.MQTTTHING_USERNAME;
  const password = device.password || defaults.password || env.MQTTTHING_PASSWORD;
  const mqttOptions = device.mqttOptions || defaults.mqttOptions || {};

  const key = stableStringify([url, username ?? null, password ?? null, mqttOptions]);
  return { url, username, password, mqttOptions, key };
}

/**
 * Opens one connection for a group of devices. The dispatch map is created
 * here and handed to every member device's context by reference, so a topic
 * several devices listen to is subscribed once and dispatched to all of them.
 */
export function openConnection(effective: EffectiveBroker, opts: OpenConnectionOptions): MqttConnection {
  const dispatch: Record<string, MessageHandler[]> = {};

  // A copy of mqttOptions: unlike accessory mode (one options object per
  // accessory) this object would be shared, and enriching the user's config
  // object with derived defaults and TLS buffers is not wanted here.
  const { url, options } = assembleBrokerOptions(
    {
      url: effective.url,
      username: effective.username,
      password: effective.password,
      mqttOptions: { ...effective.mqttOptions },
    },
    makeClientId(opts.clientBase),
    {
      topic: 'WillMsg',
      payload: 'mqtt-thing [' + opts.willName + '] has stopped',
      qos: 0,
      retain: false,
    },
  );

  const client = createDispatchingClient(url, options, opts.log, opts.logMqtt, dispatch);
  return { key: effective.key, url, client, dispatch, logMqtt: opts.logMqtt };
}

export function closeConnection(conn: MqttConnection): void {
  conn.client.end(true);
}
