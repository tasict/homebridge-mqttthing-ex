import net from 'node:net';
import os from 'node:os';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePlatforms, makePlatform, makePlatformApi, type PlatformHarness } from './hap-helpers.js';

const { Characteristic, Service } = hapNodeJs;

let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let url: string;

const clientIds: string[] = [];
const seen: Array<{ topic: string; payload: string; retain: boolean }> = [];
const subscribed: string[] = [];

beforeAll(async () => {
  broker = new Aedes();
  broker.on('client', (client) => clientIds.push(client.id));
  broker.on('publish', (packet) => {
    if (!packet.topic.startsWith('$SYS')) {
      seen.push({ topic: packet.topic, payload: String(packet.payload), retain: packet.retain });
    }
  });
  broker.on('subscribe', (subscriptions) => {
    for (const subscription of subscriptions) {
      subscribed.push(subscription.topic);
    }
  });
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = 'mqtt://localhost:' + (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  closePlatforms();
  await new Promise<void>((resolve) => broker.close(resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function harness(): PlatformHarness {
  return makePlatformApi(os.tmpdir());
}

function connectionsOf(platformName: string): string[] {
  return clientIds.filter((id) => id.startsWith(`mqttthing_${platformName}_`));
}

function brokerPublish(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) =>
    broker.publish(
      { cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}

function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (cond()) {
        return resolve();
      }
      if (Date.now() - start > ms) {
        return reject(new Error('waitFor timeout'));
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

/** Polls until reading the characteristic rejects, i.e. the device is offline. */
async function waitForOffline(characteristic: unknown, ms = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await readValue(characteristic);
    } catch {
      return;
    }
    if (Date.now() - start > ms) {
      throw new Error('waitForOffline timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function characteristicOf(accessory: { getService(s: typeof Service.Switch): Service | undefined }) {
  return accessory.getService(Service.Switch)!.getCharacteristic(Characteristic.On);
}

function readValue(characteristic: unknown): Promise<unknown> {
  return (characteristic as { handleGetRequest(): Promise<unknown> }).handleGetRequest();
}

describe('platform connection sharing', () => {
  it('opens one connection for devices sharing a broker', async () => {
    const h = harness();
    const { messages } = makePlatform(
      {
        name: 'Shared',
        url,
        devices: [
          { name: 'ShA', type: 'switch', topics: { getOn: 'sh/a' } },
          { name: 'ShB', type: 'switch', topics: { getOn: 'sh/b' } },
        ],
      },
      h,
    );

    await waitFor(() => connectionsOf('Shared').length >= 1);
    expect(connectionsOf('Shared')).toHaveLength(1);
    expect(messages.join('\n')).toContain('2 device(s) configured over 1 MQTT connection(s)');
  });

  it('opens a second connection for a device overriding the credentials', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'Split',
        url,
        username: 'shared',
        devices: [
          { name: 'SpA', type: 'switch', topics: { getOn: 'sp/a' } },
          { name: 'SpB', type: 'switch', topics: { getOn: 'sp/b' } },
          { name: 'SpC', type: 'switch', username: 'other', topics: { getOn: 'sp/c' } },
        ],
      },
      h,
    );

    await waitFor(() => connectionsOf('Split').length >= 2);
    expect(connectionsOf('Split')).toHaveLength(2);
  });

  it('names the connection after the platform, not a device', async () => {
    const h = harness();
    makePlatform({ name: 'Named', url, devices: [{ name: 'NmA', type: 'switch', topics: { getOn: 'nm/a' } }] }, h);
    await waitFor(() => connectionsOf('Named').length >= 1);
    expect(connectionsOf('Named')[0]).toMatch(/^mqttthing_Named_[0-9a-f]{1,8}$/);
  });
});

describe('platform message dispatch', () => {
  it('routes each topic to its own device', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'Routed',
        url,
        devices: [
          { name: 'RtA', type: 'switch', topics: { getOn: 'rt/a' } },
          { name: 'RtB', type: 'switch', topics: { getOn: 'rt/b' } },
        ],
      },
      h,
    );

    const a = characteristicOf(h.registered[0] as never);
    const b = characteristicOf(h.registered[1] as never);
    await waitFor(() => subscribed.includes('rt/a') && subscribed.includes('rt/b'));

    await brokerPublish('rt/a', 'true');
    await waitFor(() => a.value === true);
    expect(b.value).not.toBe(true);

    await brokerPublish('rt/b', 'true');
    await waitFor(() => b.value === true);
  });

  it('subscribes a shared topic once and delivers it to every device', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'Fanout',
        url,
        devices: [
          { name: 'FoA', type: 'switch', topics: { getOn: 'fo/shared' } },
          { name: 'FoB', type: 'switch', topics: { getOn: 'fo/shared' } },
        ],
      },
      h,
    );

    await waitFor(() => subscribed.includes('fo/shared'));
    await brokerPublish('fo/shared', 'true');

    const a = characteristicOf(h.registered[0] as never);
    const b = characteristicOf(h.registered[1] as never);
    await waitFor(() => a.value === true && b.value === true);
    expect(subscribed.filter((topic) => topic === 'fo/shared')).toHaveLength(1);
  });

  it('keeps device state independent when one goes offline', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'Offline',
        url,
        devices: [
          { name: 'OfA', type: 'switch', topics: { getOn: 'of/a', getOnline: 'of/a/online' } },
          { name: 'OfB', type: 'switch', topics: { getOn: 'of/b', getOnline: 'of/b/online' } },
        ],
      },
      h,
    );

    const a = characteristicOf(h.registered[0] as never);
    const b = characteristicOf(h.registered[1] as never);
    await waitFor(() => subscribed.includes('of/a/online') && subscribed.includes('of/b/online'));

    await brokerPublish('of/a/online', 'false');
    await waitForOffline(a);

    // B shares the connection but keeps its own state
    await expect(readValue(b)).resolves.toBeDefined();
  });

  it('applies per-device publish options on a shared connection', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'PubOpts',
        url,
        devices: [
          { name: 'PoA', type: 'switch', mqttPubOptions: { retain: true }, topics: { setOn: 'po/a' } },
          { name: 'PoB', type: 'switch', topics: { setOn: 'po/b' } },
        ],
      },
      h,
    );

    await waitFor(() => connectionsOf('PubOpts').length >= 1);
    characteristicOf(h.registered[0] as never).setValue(true);
    characteristicOf(h.registered[1] as never).setValue(true);

    await waitFor(() => seen.some((p) => p.topic === 'po/a') && seen.some((p) => p.topic === 'po/b'));
    expect(seen.find((p) => p.topic === 'po/a')!.retain).toBe(true);
    expect(seen.find((p) => p.topic === 'po/b')!.retain).toBe(false);
  });
});

describe('platform start-up publishing', () => {
  it('publishes startPub in both configuration forms', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'StartPub',
        url,
        devices: [
          {
            name: 'SpNew',
            type: 'switch',
            topics: { setOn: 'sp/new/set' },
            startPub: [
              { topic: 'sp/start/a', message: 'hello' },
              { topic: 'sp/start/empty' },
            ],
          },
          {
            name: 'SpOld',
            type: 'switch',
            topics: { setOn: 'sp/old/set' },
            startPub: { 'sp/start/b': 'legacy' },
          },
        ],
      },
      h,
    );

    await waitFor(
      () =>
        seen.some((p) => p.topic === 'sp/start/a' && p.payload === 'hello') &&
        seen.some((p) => p.topic === 'sp/start/empty' && p.payload === '') &&
        seen.some((p) => p.topic === 'sp/start/b' && p.payload === 'legacy'),
    );
  });
});

describe('platform shutdown', () => {
  it('disconnects every connection it opened', async () => {
    const h = harness();
    makePlatform(
      {
        name: 'Bye',
        url,
        devices: [
          { name: 'ByA', type: 'switch', topics: { getOn: 'by/a' } },
          { name: 'ByB', type: 'switch', username: 'other', topics: { getOn: 'by/b' } },
        ],
      },
      h,
    );

    await waitFor(() => connectionsOf('Bye').length >= 2);
    const opened = new Set(connectionsOf('Bye'));

    const disconnected = new Set<string>();
    broker.on('clientDisconnect', (client) => disconnected.add(client.id));
    h.shutdown();

    await waitFor(() => [...opened].every((id) => disconnected.has(id)));
  });
});
