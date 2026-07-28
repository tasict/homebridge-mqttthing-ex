import { createRequire } from 'node:module';

export const PLUGIN_NAME = 'homebridge-mqttthing-ex';

// The accessory name must stay "mqttthing" so existing config.json entries
// ("accessory": "mqttthing") keep working without modification.
export const ACCESSORY_NAME = 'mqttthing';

// Platform mode uses the same alias: Homebridge keeps accessory and platform
// registrations in separate maps, and sharing the name lets a device keep its
// HomeKit UUID when it moves from accessories[] to the platform's devices[].
export const PLATFORM_NAME = 'mqttthing';

const require = createRequire(import.meta.url);

export function getPluginVersion(): string {
  try {
    return require('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
}
