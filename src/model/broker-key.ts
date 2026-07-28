// Which devices share an MQTT connection.
//
// Platform mode opens one connection per distinct set of effective broker
// settings. The settings UI quantifies that ("24 connections today, 1 after
// moving"), so it has to group devices exactly as the runtime does - hence
// this module is free of Node imports and shared by both. Keeping the rule in
// one place is what stops the promise shown to the user from drifting away
// from the connections actually opened.

/** Broker settings as given by a device config or a platform block. */
export interface BrokerSettings {
  url?: string;
  username?: string;
  password?: string;
  mqttOptions?: Record<string, unknown>;
}

/** Environment fallbacks, as `process.env` provides them. */
export type BrokerEnv = Record<string, string | undefined>;

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

/** Adds the default scheme, matching what mqtt.connect is finally given. */
export function normalizeBrokerUrl(url: string): string {
  return url.includes('://') ? url : 'mqtt://' + url;
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
  env: BrokerEnv,
): EffectiveBroker {
  const url = normalizeBrokerUrl(device.url || defaults.url || env.MQTTTHING_URL || 'mqtt://localhost:1883');
  const username = device.username || defaults.username || env.MQTTTHING_USERNAME;
  const password = device.password || defaults.password || env.MQTTTHING_PASSWORD;
  const mqttOptions = device.mqttOptions || defaults.mqttOptions || {};

  const key = stableStringify([url, username ?? null, password ?? null, mqttOptions]);
  return { url, username, password, mqttOptions, key };
}
