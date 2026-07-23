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
 * Upstream-compatible config normalization (index.js:114-129):
 * - `history` given as an object silently becomes `historyOptions` with
 *   `history` treated as enabled.
 * - legacy `historyOptions.autoTimer === false` -> `noAutoTimer: true`,
 *   `autoRepeat === false` -> `noAutoRepeat: true`.
 * Mutates the config in place, as upstream does.
 */
export function normalizeHistoryConfig(config: ThingConfig): void {
  if (config.history && typeof config.history === 'object') {
    config.historyOptions = config.history as HistoryOptionsConfig;
    config.history = true;
  }
  const opts = config.historyOptions;
  if (opts) {
    if (opts.autoTimer === false) {
      opts.noAutoTimer = true;
    }
    if (opts.autoRepeat === false) {
      opts.noAutoRepeat = true;
    }
  }
}
