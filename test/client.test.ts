import net from 'node:net';

import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ThingConfig } from '../src/config.js';
import { init } from '../src/mqtt/client.js';
import type { MqttContext } from '../src/mqtt/context.js';
import { publish, subscribe } from '../src/mqtt/wiring.js';
import { makeTestLog, upstreamTestDir } from './helpers.js';

let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let port: number;
const contexts: MqttContext[] = [];

beforeAll(async () => {
  broker = new Aedes();
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  for (const ctx of contexts) {
    ctx.mqttClient?.end(true);
  }
  await new Promise<void>((resolve) => broker.close(resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeLiveCtx(config: Partial<ThingConfig> = {}) {
  const { log, messages } = makeTestLog();
  const ctx: MqttContext = {
    log,
    config: {
      accessory: 'mqttthing',
      type: 'switch',
      name: 'Integration Test',
      url: 'localhost:' + port, // no scheme: tests the mqtt:// auto-prefix
      ...config,
    } as ThingConfig,
    homebridgePath: upstreamTestDir,
    mqttDispatch: {},
    propDispatch: {},
    state: {},
  };
  init(ctx);
  contexts.push(ctx);
  return { ctx, messages };
}

function waitForConnect(ctx: MqttContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MQTT connect timeout')), 5000);
    ctx.mqttClient!.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('mqtt client init (against a real broker)', () => {
  it('connects, subscribes, and receives messages end-to-end', async () => {
    const { ctx } = makeLiveCtx();
    await waitForConnect(ctx);

    const received: unknown[] = [];
    const subscribed = new Promise<void>((resolve) => {
      broker.once('subscribe', () => resolve());
    });
    subscribe(ctx, 'itest/get', 'on', (_t, m) => received.push(String(m)));
    await subscribed;

    await new Promise<void>((resolve, reject) =>
      broker.publish({ cmd: 'publish', topic: 'itest/get', payload: Buffer.from('hello'), qos: 0, retain: false, dup: false },
        (err) => (err ? reject(err) : resolve())),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual(['hello']);
  });

  it('publishes end-to-end with mqttPubOptions', async () => {
    const seen: Array<{ topic: string; payload: string }> = [];
    const listener = (packet: { topic: string; payload: Buffer | string }) => {
      if (!packet.topic.startsWith('$SYS')) {
        seen.push({ topic: packet.topic, payload: String(packet.payload) });
      }
    };
    broker.on('publish', listener);

    const { ctx } = makeLiveCtx({ mqttPubOptions: { retain: false } });
    await waitForConnect(ctx);
    publish(ctx, 'itest/set', 'on', 'on-value');
    await new Promise((r) => setTimeout(r, 200));
    broker.removeListener('publish', listener);
    expect(seen.some((p) => p.topic === 'itest/set' && p.payload === 'on-value')).toBe(true);
  });

  it('merges user mqttOptions fill-only over mqttthing defaults', async () => {
    const { ctx } = makeLiveCtx({ mqttOptions: { keepalive: 33 } });
    await waitForConnect(ctx);
    const options = (ctx.mqttClient as unknown as { options: Record<string, unknown> }).options;
    // user-set value wins
    expect(options.keepalive).toBe(33);
    // defaults fill the rest
    expect(options.protocolVersion).toBe(4);
    expect((options.will as { topic: string }).topic).toBe('WillMsg');
    expect(String(options.clientId)).toMatch(/^mqttthing_Integration Test_[0-9a-f]+$/);
  });
});
