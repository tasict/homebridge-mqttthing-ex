// Configuration types for mqttthing accessories.
//
// These are intentionally loose: the runtime accepts every config.json that
// the original homebridge-mqttthing accepted, including unknown keys (which
// codecs may read) and legacy value forms. Normalization helpers here must
// preserve upstream quirks exactly.

/** Extended topic form: { "topic": "...", "apply": "<js function body>" }. */
export interface ExtendedTopic {
  topic: string;
  apply?: string;
  [key: string]: unknown;
}

/** A topic in config may be a plain string or the extended object form. */
export type TopicSpec = string | ExtendedTopic;

export interface HistoryOptionsConfig {
  size?: number;
  autoTimer?: boolean; // legacy alias of !noAutoTimer
  autoRepeat?: boolean; // legacy alias of !noAutoRepeat
  noAutoTimer?: boolean;
  noAutoRepeat?: boolean;
  mergeInterval?: number;
  persistencePath?: string;
  [key: string]: unknown;
}

export interface ThingConfig {
  accessory: string;
  type: string;
  name: string;

  // MQTT connection
  url?: string;
  username?: string;
  password?: string;
  mqttOptions?: Record<string, unknown>;
  mqttPubOptions?: Record<string, unknown>;
  logMqtt?: boolean;

  // topics
  topics?: Record<string, TopicSpec>;

  // behavior
  codec?: string;
  optimizePublishing?: boolean;
  debounceRecvms?: number;
  confirmationPeriodms?: number;
  retryLimit?: number;
  confirmationIndicateOffline?: boolean;
  startPub?: Array<{ topic: string; message?: string }> | Record<string, string>;
  validate?: boolean;

  // outbound publish queue (new in mqttthing-ex; disabled unless
  // publishMinIntervalms is set, keeping upstream-identical behavior)
  publishMinIntervalms?: number;
  publishQueueLimit?: number;
  publishCoalesce?: boolean;

  // boolean value mapping
  integerValue?: boolean;
  onValue?: unknown;
  offValue?: unknown;
  otherValueOff?: boolean;
  onlineValue?: unknown;
  offlineValue?: unknown;

  // accessory information
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareRevision?: string;

  // history
  history?: boolean | HistoryOptionsConfig;
  historyOptions?: HistoryOptionsConfig;

  // documented but ignored by the runtime (upstream parity)
  caption?: string;

  // multi-service ("custom" type)
  services?: ThingConfig[];
  subtype?: string;

  // everything else (type-specific options, codec options, ...)
  [key: string]: unknown;
}

/**
 * Upstream-compatible history config migration (index.js:114-131). Runs only
 * when a `history` key is present:
 * - `history` given as an object becomes `historyOptions` with `history` set
 *   to true; otherwise `historyOptions` is created if absent.
 * - legacy `autoTimer`/`autoRepeat` are migrated to `noAutoTimer` /
 *   `noAutoRepeat` (set explicitly to a boolean) unless already present.
 * Mutates the config in place, as upstream does.
 */
export function normalizeHistoryConfig(config: ThingConfig): void {
  if (!Object.prototype.hasOwnProperty.call(config, 'history')) {
    return;
  }
  if (typeof config.history === 'object' && config.history !== null) {
    config.historyOptions = config.history as HistoryOptionsConfig;
    config.history = true;
  } else if (!Object.prototype.hasOwnProperty.call(config, 'historyOptions')) {
    config.historyOptions = {};
  }
  const opts = config.historyOptions!;
  if (!Object.prototype.hasOwnProperty.call(opts, 'noAutoTimer')) {
    opts.noAutoTimer = opts.autoTimer === false;
  }
  if (!Object.prototype.hasOwnProperty.call(opts, 'noAutoRepeat')) {
    opts.noAutoRepeat = opts.autoRepeat === false;
  }
}
