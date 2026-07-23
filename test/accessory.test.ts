import net from 'node:net';
import os from 'node:os';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeAccessories, makeAccessory, makeMockApi } from './hap-helpers.js';

const { Service, Characteristic } = hapNodeJs;

let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let port: number;
let url: string;
const api = makeMockApi(os.tmpdir());

const seen: Array<{ topic: string; payload: string }> = [];

beforeAll(async () => {
  broker = new Aedes();
  broker.on('publish', (packet) => {
    if (!packet.topic.startsWith('$SYS')) {
      seen.push({ topic: packet.topic, payload: String(packet.payload) });
    }
  });
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as net.AddressInfo).port;
  url = 'mqtt://localhost:' + port;
});

afterAll(async () => {
  closeAccessories();
  await new Promise<void>((resolve) => broker.close(resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function waitForSubscription(topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timeout for ' + topic)), 5000);
    const listener = (subscriptions: Array<{ topic: string }>) => {
      if (subscriptions.some((s) => s.topic === topic)) {
        clearTimeout(timer);
        broker.removeListener('subscribe', listener as never);
        resolve();
      }
    };
    broker.on('subscribe', listener as never);
  });
}

function brokerPublish(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) =>
    broker.publish(
      { cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}

function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
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

describe('MqttThingAccessory', () => {
  it('creates a switch with On characteristic and accessory information', () => {
    const { accessory } = makeAccessory({ type: 'switch', name: 'Sw1', url, topics: { setOn: 't/sw1/set', getOn: 't/sw1/get' } }, api);
    const services = accessory.getServices();
    expect(services).toHaveLength(2);
    const swSvc = services.find((s) => s instanceof Service.Switch)!;
    expect(swSvc).toBeDefined();
    expect(swSvc.testCharacteristic(Characteristic.On)).toBe(true);
    const info = services.find((s) => s instanceof Service.AccessoryInformation)!;
    expect(info.getCharacteristic(Characteristic.Manufacturer).value).toBe('mqttthing');
    expect(info.getCharacteristic(Characteristic.Model).value).toBe('switch');
  });

  it('publishes to the set topic when HomeKit writes On', async () => {
    const { accessory } = makeAccessory({ type: 'switch', name: 'Sw2', url, topics: { setOn: 't/sw2/set' } }, api);
    const swSvc = accessory.getServices().find((s) => s instanceof Service.Switch)!;
    await swSvc.getCharacteristic(Characteristic.On).setValue(true);
    await waitFor(() => seen.some((p) => p.topic === 't/sw2/set' && p.payload === 'true'));
  });

  it('updates the On characteristic from the get topic', async () => {
    const sub = waitForSubscription('t/sw3/get');
    const { accessory } = makeAccessory(
      { type: 'switch', name: 'Sw3', url, integerValue: true, topics: { setOn: 't/sw3/set', getOn: 't/sw3/get' } },
      api,
    );
    const charac = accessory.getServices().find((s) => s instanceof Service.Switch)!.getCharacteristic(Characteristic.On);
    await sub;
    await brokerPublish('t/sw3/get', '1');
    await waitFor(() => charac.value === true);
    // unrecognized value is ignored (no exact offValue match rule uses 0 here)
    await brokerPublish('t/sw3/get', '0');
    await waitFor(() => charac.value === false);
  });

  it('builds a temperature sensor with extended range and updates from MQTT', async () => {
    const sub = waitForSubscription('t/temp/get');
    const { accessory } = makeAccessory({ type: 'temperatureSensor', name: 'Temp1', url, topics: { getCurrentTemperature: 't/temp/get' } }, api);
    const svc = accessory.getServices().find((s) => s instanceof Service.TemperatureSensor)!;
    const charac = svc.getCharacteristic(Characteristic.CurrentTemperature);
    expect(charac.props.minValue).toBe(-100);
    await sub;
    await brokerPublish('t/temp/get', '-12.5');
    await waitFor(() => charac.value === -12.5);
  });

  it('composes custom multi-service accessories with per-service state', async () => {
    const { accessory } = makeAccessory(
      {
        type: 'custom',
        name: 'Combo',
        url,
        services: [
          { name: 'Combo Switch', type: 'switch', topics: { setOn: 't/combo/sw/set' } },
          { name: 'Combo Temp', type: 'temperatureSensor', topics: { getCurrentTemperature: 't/combo/temp/get' } },
        ] as never,
      },
      api,
    );
    const services = accessory.getServices();
    // switch + temperature + accessory information
    expect(services).toHaveLength(3);
    const swSvc = services.find((s) => s instanceof Service.Switch)!;
    expect(swSvc.subtype).toBe('Combo Switch');
    const tempSvc = services.find((s) => s instanceof Service.TemperatureSensor)!;
    expect(tempSvc.subtype).toBe('Combo Temp');
  });

  it('adds an automatic battery service when battery topics are present', () => {
    const { accessory } = makeAccessory(
      { type: 'switch', name: 'SwBat', url, topics: { setOn: 't/swbat/set', getBatteryLevel: 't/swbat/bat' } },
      api,
    );
    const services = accessory.getServices();
    const batSvc = services.find((s) => s instanceof Service.Battery)!;
    expect(batSvc).toBeDefined();
    expect(batSvc.testCharacteristic(Characteristic.BatteryLevel)).toBe(true);
  });

  it('publishes startPub messages in both formats at startup', async () => {
    makeAccessory(
      {
        type: 'switch',
        name: 'SwStart',
        url,
        topics: { setOn: 't/swstart/set' },
        startPub: [{ topic: 't/start/a', message: 'hello' }, { topic: 't/start/empty' }],
      },
      api,
    );
    makeAccessory(
      {
        type: 'switch',
        name: 'SwStart2',
        url,
        topics: { setOn: 't/swstart2/set' },
        startPub: { 't/start/b': 'legacy' } as never,
      },
      api,
    );
    await waitFor(
      () =>
        seen.some((p) => p.topic === 't/start/a' && p.payload === 'hello') &&
        seen.some((p) => p.topic === 't/start/empty' && p.payload === '') &&
        seen.some((p) => p.topic === 't/start/b' && p.payload === 'legacy'),
    );
  });

  it('marks the accessory offline via getOnline and rejects reads', async () => {
    const sub = waitForSubscription('t/on4/online');
    const { accessory } = makeAccessory(
      { type: 'switch', name: 'Sw4', url, topics: { setOn: 't/sw4/set', getOnline: 't/on4/online' } },
      api,
    );
    const charac = accessory.getServices().find((s) => s instanceof Service.Switch)!.getCharacteristic(Characteristic.On);
    await sub;
    await brokerPublish('t/on4/online', 'false');
    await waitFor(() => {
      const ctx = (accessory as unknown as { ctx: { state: Record<string, unknown> } }).ctx;
      return ctx.state.online === false;
    });
    await expect(
      (charac as unknown as { handleGetRequest(): Promise<unknown> }).handleGetRequest(),
    ).rejects.toBeTruthy();
  });

  it('creates an empty accessory for an unrecognized type', () => {
    const { accessory, messages } = makeAccessory({ type: 'flying-carpet', name: 'Nope', url, topics: {} }, api);
    expect(accessory.getServices()).toEqual([]);
    expect(messages.some((m) => m.includes('Unrecognized type: flying'))).toBe(true);
  });
});
