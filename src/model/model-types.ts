// Declarative accessory-type model: TypeScript interfaces plus the global
// (type-independent) topics and options.
//
// This model is the single source of truth for:
//  (a) the custom config UI,
//  (b) config validation warnings (see validate.ts), and
//  (c) the generated fallback config.schema.json (see schema.ts).
//
// The data itself lives in types.ts (per-type) and below (globals). Where
// docs/Accessories.md and the ported service code disagree, THE CODE IS
// AUTHORITATIVE and the discrepancy is recorded in the entry's notes.

/** UI grouping for accessory types. */
export type AccessoryCategory =
  | 'Lights'
  | 'Switches & Outlets'
  | 'Sensors'
  | 'Climate'
  | 'Security & Access'
  | 'Water'
  | 'Media'
  | 'Other';

/** One MQTT topic slot (a key inside the "topics" config object). */
export interface TopicModel {
  /** Config key, e.g. 'getOn' or 'setTargetPosition'. */
  key: string;
  /** 'get' topics are subscribed (device -> HomeKit); 'set' topics are published. */
  direction: 'get' | 'set';
  /** Human-readable label for the UI. */
  label: string;
  /**
   * True only where the accessory type is non-functional without this topic
   * (per docs/Accessories.md and the service code). Missing required topics
   * are reported as errors by validateThingConfig().
   */
  required?: boolean;
  description?: string;
}

/** Value type of a configuration option (top-level config key). */
export type OptionType =
  | 'boolean'
  | 'integer'
  | 'number'
  | 'string'
  | 'stringArray'
  | 'enum'
  | 'object';

/** One top-level configuration option. */
export interface OptionModel {
  /** Top-level config key, e.g. 'valveType'. */
  key: string;
  type: OptionType;
  /** Human-readable label for the UI. */
  label: string;
  /** Default applied by the runtime when the option is omitted. */
  default?: unknown;
  /** For type 'enum': the allowed values. */
  enumValues?: string[];
  description?: string;
}

/** Declarative model of one accessory type. */
export interface AccessoryTypeModel {
  /** The config "type" value, e.g. 'lightbulb'. */
  id: string;
  /** Display name, e.g. 'Light bulb'. */
  label: string;
  category: AccessoryCategory;
  /**
   * UI-only subtype aliases (e.g. 'lightbulb-OnOff'). The runtime collapses
   * 'type-subtype' strings to the base type before dispatch.
   */
  subtypeAliases?: string[];
  /** Type-specific topics (global topics in GLOBAL_TOPICS apply to all types). */
  topics: TopicModel[];
  /** Type-specific options (global options in GLOBAL_OPTIONS apply to all types). */
  options: OptionModel[];
  /** True where the History (fakegato/Eve) service is supported. */
  supportsHistory?: boolean;
  /**
   * True where a configuration without a "topics" object is legitimate
   * (e.g. irrigationSystem keeps its topics in zones; custom keeps them in
   * services). All other types produce a validation error without topics.
   */
  topicsOptional?: boolean;
  notes?: string;
}

/**
 * Topics accepted by every accessory type. The runtime binds these in the
 * shared post-processing step (src/services/registry.ts): getName/getOnline
 * on the primary service, and the battery topics via an automatically added
 * Battery service.
 */
export const GLOBAL_TOPICS: TopicModel[] = [
  {
    key: 'getName',
    direction: 'get',
    label: 'Name',
    description: 'Reports the accessory name (HomeKit rarely shows dynamic name changes).',
  },
  {
    key: 'getOnline',
    direction: 'get',
    label: 'Online',
    description: 'Boolean online/offline state, typically published via MQTT Last Will and Testament.',
  },
  {
    key: 'getBatteryLevel',
    direction: 'get',
    label: 'Battery Level',
    description: 'Battery level from 0 to 100. Adds a battery service automatically.',
  },
  {
    key: 'getChargingState',
    direction: 'get',
    label: 'Charging State',
    description: 'Charging state; values configurable with chargingStateValues. Adds a battery service automatically.',
  },
  {
    key: 'getStatusLowBattery',
    direction: 'get',
    label: 'Status Low Battery',
    description: 'Boolean low-battery indication.',
  },
];

/** Options accepted by every accessory type (docs/Configuration.md + src/config.ts). */
export const GLOBAL_OPTIONS: OptionModel[] = [
  { key: 'url', type: 'string', label: 'MQTT URL', description: 'URL of the MQTT broker (defaults to mqtt://localhost:1883).' },
  { key: 'username', type: 'string', label: 'MQTT Username' },
  { key: 'password', type: 'string', label: 'MQTT Password' },
  { key: 'mqttOptions', type: 'object', label: 'MQTT Connection Options', description: 'Options object passed through to mqtt.connect().' },
  { key: 'mqttPubOptions', type: 'object', label: 'MQTT Publishing Options', description: 'Options object passed through to mqtt publish().' },
  { key: 'logMqtt', type: 'boolean', label: 'Log MQTT', default: false, description: 'Enable MQTT logging for this accessory.' },
  { key: 'codec', type: 'string', label: 'Codec', description: 'Path of a JavaScript codec file used to encode/decode MQTT messages.' },
  { key: 'debounceRecvms', type: 'integer', label: 'Receive Debounce [ms]', description: 'Debounce period applied to received messages.' },
  { key: 'optimizePublishing', type: 'boolean', label: 'Optimize Publishing', default: false, description: 'Do not republish unchanged values.' },
  { key: 'confirmationPeriodms', type: 'integer', label: 'Confirmation Period [ms]', description: 'Enables set/get publishing confirmation where supported.' },
  { key: 'retryLimit', type: 'integer', label: 'Confirmation Retry Limit', default: 3, description: 'Maximum number of confirmation republish attempts.' },
  { key: 'confirmationIndicateOffline', type: 'boolean', label: 'Confirmation Indicates Offline', description: 'Indicate offline (No Response) when confirmation fails.' },
  { key: 'startPub', type: 'object', label: 'Start-up Publications', description: 'Array of { topic, message } objects published on start-up (legacy topic->message object also accepted).' },
  { key: 'validate', type: 'boolean', label: 'Validate Values', default: true, description: 'Set to false to disable HomeKit value validation for this accessory.' },
  { key: 'publishMinIntervalms', type: 'integer', label: 'Minimum Publish Interval [ms]', description: 'mqttthing-ex outbound publish queue: minimum interval between publishes (queue disabled when unset).' },
  { key: 'publishQueueLimit', type: 'integer', label: 'Publish Queue Limit', description: 'mqttthing-ex outbound publish queue: maximum queued messages.' },
  { key: 'publishCoalesce', type: 'boolean', label: 'Publish Coalescing', description: 'mqttthing-ex outbound publish queue: replace queued messages for the same topic.' },
  { key: 'integerValue', type: 'boolean', label: 'Integer Values', default: false, description: 'Use 1/0 instead of true/false for Boolean values.' },
  { key: 'onValue', type: 'string', label: 'On Value', description: 'Specific value representing Boolean true/on.' },
  { key: 'offValue', type: 'string', label: 'Off Value', description: 'Specific value representing Boolean false/off.' },
  { key: 'otherValueOff', type: 'boolean', label: 'Other Values Mean Off', default: false, description: 'Treat unrecognized received values as off.' },
  { key: 'onlineValue', type: 'string', label: 'Online Value', description: 'Specific value representing the online state (getOnline).' },
  { key: 'offlineValue', type: 'string', label: 'Offline Value', description: 'Specific value representing the offline state (getOnline).' },
  {
    key: 'chargingStateValues',
    type: 'stringArray',
    label: 'Charging State Values',
    default: ['NOT_CHARGING', 'CHARGING', 'NOT_CHARGEABLE'],
    description: 'Values representing not-charging, charging and not-chargeable (getChargingState).',
  },
  { key: 'manufacturer', type: 'string', label: 'Manufacturer', default: 'mqttthing', description: 'Accessory information service manufacturer.' },
  { key: 'model', type: 'string', label: 'Model', description: 'Accessory information service model (defaults to the accessory type).' },
  { key: 'serialNumber', type: 'string', label: 'Serial Number', description: 'Accessory information service serial number (defaults to hostname and accessory name).' },
  { key: 'firmwareRevision', type: 'string', label: 'Firmware Revision', description: 'Accessory information service firmware revision (defaults to the plugin version).' },
  { key: 'history', type: 'boolean', label: 'Enable History', default: false, description: 'Enable the Eve history service (supported types only).' },
  { key: 'historyOptions', type: 'object', label: 'History Options', description: 'History options: size (default 4032), noAutoTimer, noAutoRepeat, mergeInterval, persistencePath.' },
  { key: 'caption', type: 'string', label: 'Caption', description: 'HomeKit caption/label (documented upstream; ignored by the runtime).' },
  { key: 'nameOverride', type: 'string', label: 'Name Override', description: 'Overrides the configured name of the created service (ConfiguredName).' },
];
