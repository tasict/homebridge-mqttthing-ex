import type { MqttClient } from 'mqtt';

import type { ThingConfig } from '../config.js';
import type { Log } from '../log.js';
import type { Codec } from '../codec/loader.js';
import type { PublishQueue } from './queue.js';

/** Handler receiving raw or decoded MQTT payloads. */
export type MessageHandler = (topic: string, message: unknown) => void;

/**
 * Per-accessory MQTT context, the equivalent of upstream's `ctx` object that
 * mqttlib threads through every call. One context (and one MQTT connection)
 * exists per accessory; for "custom" multi-service accessories the same
 * context is shared by all sub-services while `state` is replaced with a
 * fresh object per sub-service (upstream index.js:185).
 */
export interface MqttContext {
  log: Log;
  config: ThingConfig;
  homebridgePath: string;

  mqttClient?: MqttClient;
  /** map of topic -> handlers */
  mqttDispatch: Record<string, MessageHandler[]>;
  /** map of property -> raw handlers, used by codec notify() */
  propDispatch: Record<string, MessageHandler[]>;
  /** last published value per topic, present when optimizePublishing is on */
  lastPubValues?: Record<string, string>;
  codec?: Codec | null;
  /** per-property scratch state for apply() expressions */
  applyState?: {
    props: Record<string, Record<string, unknown>>;
    global: Record<string, unknown>;
  };
  /** current accessory state (per sub-service); holds `online` among others */
  state: Record<string, unknown>;
  /** outbound publish queue, present when publishMinIntervalms is configured */
  publishQueue?: PublishQueue;
}

/**
 * Per-property apply() scratch state (upstream mqttlib.js:197-205). Each
 * property gets its own object seeded with a shared `global` reference.
 */
export function getApplyState(ctx: MqttContext, property: string): Record<string, unknown> {
  if (!ctx.applyState) {
    ctx.applyState = { props: {}, global: {} };
  }
  if (!Object.prototype.hasOwnProperty.call(ctx.applyState.props, property)) {
    ctx.applyState.props[property] = { global: ctx.applyState.global };
  }
  return ctx.applyState.props[property];
}
