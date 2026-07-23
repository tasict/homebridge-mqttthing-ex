import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThingConfig } from '../src/config.js';
import type { Log } from '../src/log.js';
import type { MqttContext } from '../src/mqtt/context.js';
import { PublishQueue } from '../src/mqtt/queue.js';
import { rawSend } from '../src/mqtt/wiring.js';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const upstreamTestDir = path.join(repoRoot, 'test', 'fixtures', 'upstream');

export interface TestLog {
  log: Log;
  messages: string[];
}

export function makeTestLog(): TestLog {
  const messages: string[] = [];
  const log = ((message: string) => {
    messages.push(message);
  }) as Log;
  log.warn = (message: string) => messages.push('WARN: ' + message);
  log.error = (message: string) => messages.push('ERROR: ' + message);
  return { log, messages };
}

export interface PublishedMessage {
  topic: string;
  message: string;
  opts: unknown;
}

export interface StubClient {
  client: { publish: (t: string, m: string, o?: unknown) => void; subscribe: (t: string) => void };
  published: PublishedMessage[];
  subscribed: string[];
}

export function makeStubClient(): StubClient {
  const published: PublishedMessage[] = [];
  const subscribed: string[] = [];
  const client = {
    publish: (topic: string, message: string, opts?: unknown) => {
      published.push({ topic, message, opts });
    },
    subscribe: (topic: string) => {
      subscribed.push(topic);
    },
  };
  return { client, published, subscribed };
}

export interface TestCtx {
  ctx: MqttContext;
  published: PublishedMessage[];
  subscribed: string[];
  messages: string[];
  /** simulate an incoming broker message, as the client 'message' handler would */
  dispatch: (topic: string, message: unknown) => void;
}

export function makeCtx(config: Partial<ThingConfig> = {}): TestCtx {
  const { log, messages } = makeTestLog();
  const { client, published, subscribed } = makeStubClient();
  const fullConfig = {
    accessory: 'mqttthing',
    type: 'switch',
    name: 'Test Thing',
    ...config,
  } as ThingConfig;
  const ctx: MqttContext = {
    log,
    config: fullConfig,
    homebridgePath: upstreamTestDir,
    mqttDispatch: {},
    propDispatch: {},
    state: {},
    mqttClient: client as unknown as MqttContext['mqttClient'],
  };
  if (fullConfig.optimizePublishing) {
    ctx.lastPubValues = {};
  }
  if (fullConfig.publishMinIntervalms) {
    ctx.publishQueue = new PublishQueue(
      (topic, message) => rawSend(ctx, topic, message),
      fullConfig.publishMinIntervalms,
      fullConfig.publishQueueLimit ?? 1000,
      fullConfig.publishCoalesce !== false,
      log,
    );
  }
  const dispatch = (topic: string, message: unknown) => {
    const handlers = ctx.mqttDispatch[topic];
    if (handlers) {
      for (const handler of [...handlers]) {
        handler(topic, message);
      }
    }
  };
  return { ctx, published, subscribed, messages, dispatch };
}
