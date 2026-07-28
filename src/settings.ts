import { createRequire } from 'node:module';

export const PLUGIN_NAME = 'homebridge-mqttthing-ex';

// The accessory name must stay "mqttthing" so existing config.json entries
// ("accessory": "mqttthing") keep working without modification.
export const ACCESSORY_NAME = 'mqttthing';

// Platform mode is new, so it carries this plugin's own name: Homebridge
// prefixes the platform's log messages with it, which is how a reader tells
// which plugin is speaking. A device keeps its HomeKit UUID when it moves
// into the platform regardless, because that identity is derived from
// ACCESSORY_NAME, not from the platform alias.
export const PLATFORM_NAME = 'mqttthing-ex';

const require = createRequire(import.meta.url);

export function getPluginVersion(): string {
  try {
    return require('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
}
