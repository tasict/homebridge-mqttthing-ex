// Fallback config.schema.json generator, driven by the declarative
// accessory-type model. Produces a minimal Homebridge config-ui-x compatible
// schema: the full custom UI supersedes it, but config-ui-x falls back to
// this schema form when the custom UI is unavailable.
//
// config.schema.json is generated from this module (plus the customUi
// switches) by scripts/generate-schema.mjs, wired into prepublishOnly as
// `npm run generate:schema`.
import { PLATFORM_NAME } from '../settings.js';
import { ACCESSORY_TYPES } from './types.js';

interface TypeChoice {
  title: string;
  enum: string[];
}

/** Human-readable title for a lightbulb subtype alias, e.g. 'lightbulb-OnOff'. */
function subtypeAliasTitle(baseLabel: string, alias: string): string {
  const suffix = alias.substring(alias.indexOf('-') + 1);
  return `${baseLabel} (${suffix})`;
}

/**
 * Per-device properties. A device entry is an accessory block without
 * "accessory", so this is also the shape of a legacy accessories[] entry -
 * which is why the custom UI can edit both with one editor.
 *
 * @param typeChoices accessory type enum, generated from the type model
 */
function deviceProperties(typeChoices: TypeChoice[]): Record<string, unknown> {
  return {
    name: {
      type: 'string',
      title: 'Name',
      description: 'Name of the device, as displayed in HomeKit.',
    },
    type: {
      type: 'string',
      title: 'Type',
      description: 'Accessory type.',
      oneOf: typeChoices,
    },
    id: {
      type: 'string',
      title: 'Identifier',
      description:
        'Stable identity of the device. Written once, when the device is created or moved here; ' +
        'changing it later makes HomeKit treat the device as new.',
    },
    url: {
      type: 'string',
      title: 'MQTT URL',
      description: 'Overrides the broker URL of the platform for this device only.',
    },
    username: {
      type: 'string',
      title: 'MQTT Username',
      description: 'Overrides the broker username of the platform for this device only.',
    },
    password: {
      type: 'string',
      title: 'MQTT Password',
      description: 'Overrides the broker password of the platform for this device only.',
    },
    topics: {
      type: 'object',
      title: 'MQTT Topics',
      description:
        'MQTT topics used by the device (getXxx report state, setXxx control the device). ' +
        'See docs/Accessories.md for the topics of each type.',
      additionalProperties: true,
    },
    logMqtt: {
      type: 'boolean',
      title: 'Log MQTT',
      description: 'Enable MQTT logging for this device.',
      default: false,
    },
    integerValue: {
      type: 'boolean',
      title: 'Integer Values',
      description: 'Use 1/0 instead of true/false for Boolean values.',
      default: false,
    },
    onValue: {
      type: 'string',
      title: 'On Value',
      description: 'Specific value representing Boolean true/on.',
    },
    offValue: {
      type: 'string',
      title: 'Off Value',
      description: 'Specific value representing Boolean false/off.',
    },
    otherValueOff: {
      type: 'boolean',
      title: 'Other Values Mean Off',
      description: 'Treat unrecognized received values as off.',
      default: false,
    },
    onlineValue: {
      type: 'string',
      title: 'Online Value',
      description: 'Specific value representing the online state (getOnline topic).',
    },
    offlineValue: {
      type: 'string',
      title: 'Offline Value',
      description: 'Specific value representing the offline state (getOnline topic).',
    },
    codec: {
      type: 'string',
      title: 'Codec',
      description: 'Path of a JavaScript codec file used to encode/decode MQTT messages.',
    },
    confirmationPeriodms: {
      type: 'integer',
      title: 'Confirmation Period [ms]',
      description: 'Enables set/get publishing confirmation where supported.',
    },
    retryLimit: {
      type: 'integer',
      title: 'Confirmation Retry Limit',
      description: 'Maximum number of confirmation republish attempts.',
      default: 3,
    },
    debounceRecvms: {
      type: 'integer',
      title: 'Receive Debounce [ms]',
      description: 'Debounce period applied to received messages.',
    },
    optimizePublishing: {
      type: 'boolean',
      title: 'Optimize Publishing',
      description: 'Do not republish unchanged values.',
      default: false,
    },
    history: {
      type: 'boolean',
      title: 'Enable History',
      description: 'Enable the Eve history service (supported accessory types only).',
      default: false,
    },
    manufacturer: {
      type: 'string',
      title: 'Manufacturer',
      description: 'Accessory information service manufacturer.',
    },
    model: {
      type: 'string',
      title: 'Model',
      description: 'Accessory information service model.',
    },
    serialNumber: {
      type: 'string',
      title: 'Serial Number',
      description: 'Accessory information service serial number.',
    },
    firmwareRevision: {
      type: 'string',
      title: 'Firmware Revision',
      description: 'Accessory information service firmware revision.',
    },
    caption: {
      type: 'string',
      title: 'Caption',
      description: 'HomeKit caption/label.',
    },
  };
}

/**
 * Generate a minimal fallback schema object compatible with Homebridge
 * config-ui-x.
 *
 * A plugin gets exactly one schema, and this one describes the platform block:
 * config-ui-x derives from pluginAlias/pluginType which config.json array it
 * manages, so declaring the platform here is what puts the forward-looking
 * configuration under its care - including child-bridge management, which
 * it only offers for blocks it owns. Legacy accessories[] entries are read and
 * written by the custom UI's own server instead (homebridge-ui/server-lib.mjs).
 *
 * `required` is deliberately an array at the object level: a boolean
 * `required` on an individual property is not valid JSON Schema, and the
 * Homebridge plugin verification checks reject it.
 */
export function generateConfigSchema(): Record<string, unknown> {
  const typeChoices: TypeChoice[] = [];
  for (const type of ACCESSORY_TYPES) {
    typeChoices.push({ title: type.label, enum: [type.id] });
    for (const alias of type.subtypeAliases ?? []) {
      typeChoices.push({ title: subtypeAliasTitle(type.label, alias), enum: [alias] });
    }
  }
  typeChoices.sort((a, b) => a.title.localeCompare(b.title));

  return {
    pluginAlias: PLATFORM_NAME,
    pluginType: 'platform',
    singular: true,
    headerDisplay:
      'This fallback form edits the platform block. The plugin ships a settings UI of its own that ' +
      'supersedes it, and that is also where legacy "accessory": "mqttthing" entries are managed - ' +
      'see the Platform mode section of the README.',
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          title: 'Name',
          description: 'Name of the platform, used as the prefix of its log messages.',
          default: 'MQTT Thing',
        },
        url: {
          type: 'string',
          title: 'MQTT URL',
          description:
            'URL of the MQTT broker, e.g. mqtt://192.168.1.10:1883 (defaults to mqtt://localhost:1883). ' +
            'Devices sharing these settings share one connection.',
        },
        username: {
          type: 'string',
          title: 'MQTT Username',
        },
        password: {
          type: 'string',
          title: 'MQTT Password',
        },
        mqttOptions: {
          type: 'object',
          title: 'MQTT Options',
          description: 'Additional options passed to the MQTT client.',
          additionalProperties: true,
        },
        devices: {
          type: 'array',
          title: 'Devices',
          description: 'Devices served by this platform.',
          items: {
            type: 'object',
            title: 'Device',
            properties: deviceProperties(typeChoices),
            required: ['name', 'type'],
          },
        },
      },
      required: ['name'],
    },
  };
}
