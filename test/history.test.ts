// Tests for the fakegato-history (Eve app history) integration in
// src/features/history.ts, including the F5 subtype-uniqueness fix
// (upstream #605, #201).
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ThingContext } from '../src/hap/binding.js';
import { makeEve } from '../src/hap/eve.js';
import { makeHistoryService, setFakegatoLoaderForTesting } from '../src/features/history.js';
import { closeAccessories, makeAccessory, makeMockApi } from './hap-helpers.js';
import { makeTestLog } from './helpers.js';

const { Service, Characteristic } = hapNodeJs;
const eve = makeEve(hapNodeJs as never);

const FAKEGATO_UUID = 'E863F007-079E-48FF-8F27-9C2605A29F52';

interface HistoryServiceLike {
  UUID: string;
  subtype?: string;
  addEntry(entry: Record<string, unknown>): void;
  testCharacteristic(characteristic: unknown): boolean;
}

let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let port: number;
let url: string;

// history persistence and counter files must land in a private temp dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqttthing-history-'));
const api = makeMockApi(tmpDir);

beforeAll(async () => {
  broker = new Aedes();
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as net.AddressInfo).port;
  url = 'mqtt://localhost:' + port;
});

afterAll(async () => {
  closeAccessories();
  // fakegato's global averaging timer (10min interval) would keep running
  const fakegatoGlobals = api as unknown as { globalFakeGatoTimer?: { stop(): void } };
  fakegatoGlobals.globalFakeGatoTimer?.stop();
  await new Promise<void>((resolve) => broker.close(resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('fakegato history', () => {
  it('adds a switch history service and logs On changes', async () => {
    const { accessory } = makeAccessory(
      { type: 'switch', name: 'HSw1', url, history: true, topics: { setOn: 't/hsw1/set', getOn: 't/hsw1/get' } },
      api,
    );
    const services = accessory.getServices();
    // switch + history + accessory information
    expect(services).toHaveLength(3);
    const histSvc = services.find((s) => s.UUID === FAKEGATO_UUID) as unknown as HistoryServiceLike;
    expect(histSvc).toBeDefined();

    const swSvc = services.find((s) => s instanceof Service.Switch)!;
    const addEntry = vi.spyOn(histSvc, 'addEntry');
    await swSvc.getCharacteristic(Characteristic.On).setValue(true);
    await waitFor(() => addEntry.mock.calls.length >= 1);
    expect(addEntry.mock.calls[0][0]).toMatchObject({ status: 1 });
    expect(addEntry.mock.calls[0][0]).toHaveProperty('time');
    // the change handler also maintains Eve's LastActivation on the switch
    expect(swSvc.testCharacteristic(eve.Characteristics.LastActivation)).toBe(true);
  });

  it('logs weather entries for a temperature sensor from MQTT messages', async () => {
    const sub = waitForSubscription('t/htemp/get');
    const { accessory } = makeAccessory(
      {
        type: 'temperatureSensor',
        name: 'HTemp',
        url,
        // object form of history exercises the historyOptions migration too
        history: { autoTimer: false } as never,
        topics: { getCurrentTemperature: 't/htemp/get' },
      },
      api,
    );
    const histSvc = accessory.getServices().find((s) => s.UUID === FAKEGATO_UUID) as unknown as HistoryServiceLike;
    expect(histSvc).toBeDefined();
    const addEntry = vi.spyOn(histSvc, 'addEntry');
    await sub;
    await brokerPublish('t/htemp/get', '22.5');
    await waitFor(() => addEntry.mock.calls.length >= 1);
    expect(addEntry.mock.calls[0][0]).toMatchObject({ temp: 22.5 });
  });

  it('merges motion off-events within historyOptions.mergeInterval', async () => {
    const sub = waitForSubscription('t/hmot/get');
    const { accessory } = makeAccessory(
      {
        type: 'motionSensor',
        name: 'HMotion',
        url,
        integerValue: true,
        history: true,
        historyOptions: { mergeInterval: 0.005 }, // 300ms
        topics: { getMotionDetected: 't/hmot/get' },
      },
      api,
    );
    const histSvc = accessory.getServices().find((s) => s.UUID === FAKEGATO_UUID) as unknown as HistoryServiceLike;
    expect(histSvc).toBeDefined();
    const addEntry = vi.spyOn(histSvc, 'addEntry');
    await sub;

    // on-event is logged immediately
    await brokerPublish('t/hmot/get', '1');
    await waitFor(() => addEntry.mock.calls.length >= 1);
    expect(addEntry.mock.calls[0][0]).toMatchObject({ status: 1 });

    // off-event followed by an on-event within the merge interval: the
    // off-event is discarded and only the new on-event is logged
    await brokerPublish('t/hmot/get', '0');
    await brokerPublish('t/hmot/get', '1');
    await waitFor(() => addEntry.mock.calls.length >= 2);
    expect(addEntry.mock.calls[1][0]).toMatchObject({ status: 1 });
    await delay(400); // longer than the merge interval
    expect(addEntry.mock.calls.length).toBe(2); // merged off-event never logged

    // an off-event with no new on-event is logged after the merge interval
    await brokerPublish('t/hmot/get', '0');
    await waitFor(() => (accessory as unknown as { ctx: { state: Record<string, unknown> } }).ctx.state.motionDetected === false);
    expect(addEntry.mock.calls.length).toBe(2); // not logged yet
    await waitFor(() => addEntry.mock.calls.length >= 3);
    expect(addEntry.mock.calls[2][0]).toMatchObject({ status: 0 });
  });

  it('gives each history service of a custom accessory a unique subtype (F5)', () => {
    const { accessory } = makeAccessory(
      {
        type: 'custom',
        name: 'HCombo',
        url,
        services: [
          { name: 'HSwA', type: 'switch', history: true, topics: { setOn: 't/hcombo/a/set' } },
          { name: 'HSwB', type: 'switch', history: true, topics: { setOn: 't/hcombo/b/set' } },
        ] as never,
      },
      api,
    );
    const services = accessory.getServices();
    // 2 switches + 2 history services + accessory information
    expect(services).toHaveLength(5);
    const histSvcs = services.filter((s) => s.UUID === FAKEGATO_UUID);
    expect(histSvcs).toHaveLength(2);
    // first history service keeps upstream's no-subtype form; the second gets
    // a unique subtype derived from the sub-service subtype
    expect(histSvcs[0].subtype).toBeUndefined();
    expect(histSvcs[1].subtype).toBe('HSwB');
    expect(histSvcs[0].subtype).not.toBe(histSvcs[1].subtype);

    // HAP accepts all services on a single accessory (upstream threw
    // "Cannot add a Service with the same UUID" here)
    const acc = new hapNodeJs.Accessory('HCombo', hapNodeJs.uuid.generate('HCombo'));
    for (const svc of services) {
      if (!(svc instanceof Service.AccessoryInformation)) {
        acc.addService(svc as never);
      }
    }
    expect(acc.services.filter((s) => s.UUID === FAKEGATO_UUID)).toHaveLength(2);
  });

  it('creates no history service when history is disabled', () => {
    const { accessory } = makeAccessory(
      { type: 'switch', name: 'HOff', url, topics: { setOn: 't/hoff/set' } },
      api,
    );
    expect(accessory.getServices().some((s) => s.UUID === FAKEGATO_UUID)).toBe(false);
  });

  it('makeHistoryService returns null gracefully when fakegato-history cannot be loaded', () => {
    const { log, messages } = makeTestLog();
    const thing = {
      api: makeMockApi(tmpDir),
      log,
      config: { name: 'NoHist', history: true, historyOptions: {} },
      mqttCtx: {},
    } as unknown as ThingContext;
    setFakegatoLoaderForTesting(() => {
      throw new Error('simulated fakegato load failure');
    });
    try {
      expect(makeHistoryService(thing, 'switch')).toBeNull();
      expect(messages.some((m) => m.includes('ERROR: Unable to load fakegato-history'))).toBe(true);
      expect(messages.some((m) => m.includes('WARN: History is unavailable'))).toBe(true);
    } finally {
      setFakegatoLoaderForTesting(null);
    }
  });

  it('builds an accessory without history when fakegato-history fails to load', () => {
    setFakegatoLoaderForTesting(() => {
      throw new Error('simulated fakegato load failure');
    });
    try {
      const { accessory, messages } = makeAccessory(
        { type: 'switch', name: 'HBroken', url, history: true, topics: { setOn: 't/hbroken/set' } },
        makeMockApi(tmpDir),
      );
      const services = accessory.getServices();
      // switch + accessory information, but no history service and no crash
      expect(services).toHaveLength(2);
      expect(services.some((s) => s.UUID === FAKEGATO_UUID)).toBe(false);
      expect(messages.some((m) => m.includes('ERROR: Unable to load fakegato-history'))).toBe(true);
    } finally {
      setFakegatoLoaderForTesting(null);
    }
  });

  it('counts TimesOpened for a contact sensor and persists the counter file', async () => {
    const sub = waitForSubscription('t/hcs/get');
    const { accessory } = makeAccessory(
      {
        type: 'contactSensor',
        name: 'HContact',
        url,
        integerValue: true,
        history: true,
        topics: { getContactSensorState: 't/hcs/get' },
      },
      api,
    );
    const services = accessory.getServices();
    const contactSvc = services.find((s) => s instanceof Service.ContactSensor)!;
    const histSvc = services.find((s) => s.UUID === FAKEGATO_UUID) as unknown as HistoryServiceLike;
    expect(histSvc).toBeDefined();

    // the counter file is loaded asynchronously before the Eve
    // characteristics are added and the change handler is attached
    await waitFor(() => contactSvc.testCharacteristic(eve.Characteristics.TimesOpened));
    expect(contactSvc.testCharacteristic(eve.Characteristics.OpenDuration)).toBe(true);
    expect(contactSvc.testCharacteristic(eve.Characteristics.ClosedDuration)).toBe(true);
    expect(histSvc.testCharacteristic(eve.Characteristics.ResetTotal)).toBe(true);

    await sub;
    await brokerPublish('t/hcs/get', '1'); // open
    await waitFor(() => contactSvc.getCharacteristic(eve.Characteristics.TimesOpened).value === 1);

    // counter file is written to the (temp) storage path
    const counterFile = path.join(tmpDir, os.hostname().split('.')[0] + '_HContact_cnt_persist.json');
    await waitFor(() => fs.existsSync(counterFile));
    await waitFor(() => {
      try {
        return JSON.parse(fs.readFileSync(counterFile, 'utf8')).timesOpened === 1;
      } catch {
        return false; // file may still be mid-write
      }
    });
    const saved = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    expect(saved.timesOpened).toBe(1);
    expect(saved).toHaveProperty('resetTotal');
  });
});
