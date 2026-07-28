// How a configuration entry maps to a HomeKit accessory.
//
// This rule is the load-bearing promise of platform mode: a device moved out
// of accessories[] keeps its rooms, scenes and automations only because both
// sides agree on it exactly. The runtime and the settings UI must therefore
// derive it from one definition - which is why this module is free of Node
// imports, so the browser bundle can use it too. Only the hashing itself is
// implemented twice (Homebridge's own hap.uuid at runtime, a SHA-1 in the UI
// where crypto.subtle is unavailable over plain HTTP), and those two are
// pinned against each other in test/ui-hap-uuid.test.ts.

/** Alias of accessory blocks: unchanged from the plugin this one succeeds. */
export const ACCESSORY_ALIAS = 'mqttthing';

/** Alias of the platform block. Also the prefix of its log messages. */
export const PLATFORM_ALIAS = 'mqttthing-ex';

/** Homebridge hashes the accessory alias together with the seed. */
export const IDENTITY_PREFIX = `${ACCESSORY_ALIAS}:`;

/** Which configuration container an entry lives in. */
export type DeviceSource = 'accessory' | 'platform';

/** Just enough of a configuration entry to identify it. */
export interface IdentityFields {
  id?: unknown;
  uuid_base?: unknown;
  name?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a UUID, and so names an accessory outright. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * What the accessory UUID comes from.
 *
 * A platform device may set `id`; anything else - and every accessory block,
 * where Homebridge never reads an id - is identified by `uuid_base` or the
 * name. A seed that is a UUID is the accessory itself and must not be hashed
 * again: that is what moving a device writes.
 */
export function identitySeed(config: IdentityFields, source: DeviceSource): string {
  if (source === 'platform') {
    const id = text(config.id);
    if (id !== undefined) {
      return id;
    }
  }
  return text(config.uuid_base) ?? String(config.name ?? '');
}
