// Fallback config.schema.json generator, driven by the declarative
// accessory-type model. Produces a minimal Homebridge config-ui-x compatible
// schema: the full custom UI supersedes it, but config-ui-x falls back to
// this schema form when the custom UI is unavailable.
//
// config.schema.json is generated from this module (plus the customUi
// switches) by scripts/generate-schema.mjs, wired into prepublishOnly as
// `npm run generate:schema`.
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
 * Generate a minimal fallback schema object compatible with Homebridge
 * config-ui-x. Header fields match the shipped config.schema.json
 * (pluginAlias 'mqttthing', pluginType 'accessory') plus singular: false,
 * since one accessory config may be added many times.
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
    pluginAlias: 'mqttthing',
    pluginType: 'accessory',
    singular: false,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          title: 'Name',
          description: 'Name of the accessory, as displayed in HomeKit.',
          required: true,
        },
        type: {
          type: 'string',
          title: 'Type',
          description: 'Accessory type.',
          oneOf: typeChoices,
          required: true,
        },
        url: {
          type: 'string',
          title: 'MQTT URL',
          description: 'URL of the MQTT broker, e.g. mqtt://192.168.1.10:1883 (defaults to mqtt://localhost:1883).',
        },
        username: {
          type: 'string',
          title: 'MQTT Username',
        },
        password: {
          type: 'string',
          title: 'MQTT Password',
        },
        topics: {
          type: 'object',
          title: 'MQTT Topics',
          description: 'MQTT topics used by the accessory (getXxx report state, setXxx control the device). See docs/Accessories.md for the topics of each type.',
          additionalProperties: true,
        },
        logMqtt: {
          type: 'boolean',
          title: 'Log MQTT',
          description: 'Enable MQTT logging for this accessory.',
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
      },
    },
  };
}
