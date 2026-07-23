// Tests for upstream-issue fixes carried by the rewrite
// (see docs/UpstreamIssues.md).
import os from 'node:os';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import { afterAll, describe, expect, it } from 'vitest';

import { publish, subscribe, topicFilterMatches } from '../src/mqtt/wiring.js';
import { closeAccessories, makeAccessory, makeMockApi } from './hap-helpers.js';
import { makeCtx } from './helpers.js';

const { Service, Characteristic } = hapNodeJs;
const api = makeMockApi(os.tmpdir());

afterAll(() => {
  closeAccessories();
});

// deliver an MQTT message to an accessory without a broker
function dispatchTo(accessory: unknown, topic: string, message: string): void {
  const ctx = (accessory as { ctx: { mqttDispatch: Record<string, Array<(t: string, m: unknown) => void>> } }).ctx;
  for (const handler of ctx.mqttDispatch[topic] ?? []) {
    handler(topic, Buffer.from(message));
  }
}

describe('F4: wildcard topic matching (#500)', () => {
  it('matches MQTT topic filters per spec', () => {
    expect(topicFilterMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicFilterMatches('a/+/c', 'a/b/d')).toBe(false);
    expect(topicFilterMatches('a/#', 'a/b/c/d')).toBe(true);
    expect(topicFilterMatches('a/#', 'a')).toBe(true);
    expect(topicFilterMatches('+/b', 'a/b')).toBe(true);
    expect(topicFilterMatches('+/b', 'a/b/c')).toBe(false);
    expect(topicFilterMatches('a/b', 'a/b')).toBe(true);
    expect(topicFilterMatches('a/b', 'a/c')).toBe(false);
  });
});

describe('F3: temperature range must not clamp CurrentTemperature (#587, #592)', () => {
  it('keeps the wide default range but allows widening', () => {
    const { accessory } = makeAccessory(
      {
        type: 'temperatureSensor',
        name: 'F3a',
        minTemperature: 5,
        maxTemperature: 30,
        topics: { getCurrentTemperature: 't/f3a/get' },
      },
      api,
    );
    const charac = accessory
      .getServices()
      .find((s) => s instanceof Service.TemperatureSensor)!
      .getCharacteristic(Characteristic.CurrentTemperature);
    expect(charac.props.minValue).toBe(-100);
    expect(charac.props.maxValue).toBe(100);
    // a real reading outside the configured settable range is accepted
    dispatchTo(accessory, 't/f3a/get', '34.5');
    expect(charac.value).toBe(34.5);

    const wide = makeAccessory(
      {
        type: 'temperatureSensor',
        name: 'F3b',
        minTemperature: -150,
        maxTemperature: 200,
        topics: { getCurrentTemperature: 't/f3b/get' },
      },
      api,
    );
    const wideCharac = wide.accessory
      .getServices()
      .find((s) => s instanceof Service.TemperatureSensor)!
      .getCharacteristic(Characteristic.CurrentTemperature);
    expect(wideCharac.props.minValue).toBe(-150);
    expect(wideCharac.props.maxValue).toBe(200);
  });
});

describe('F9: StatusTampered emits UINT8 values (#631)', () => {
  it('maps truthy MQTT values to 1/0', () => {
    const { accessory } = makeAccessory(
      {
        type: 'motionSensor',
        name: 'F9',
        topics: { getMotionDetected: 't/f9/motion', getStatusTampered: 't/f9/tamper' },
      },
      api,
    );
    const charac = accessory
      .getServices()
      .find((s) => s instanceof Service.MotionSensor)!
      .getCharacteristic(Characteristic.StatusTampered);
    dispatchTo(accessory, 't/f9/tamper', 'true');
    expect(charac.value).toBe(Characteristic.StatusTampered.TAMPERED);
    dispatchTo(accessory, 't/f9/tamper', 'false');
    expect(charac.value).toBe(Characteristic.StatusTampered.NOT_TAMPERED);
  });
});

describe('F15: fanv2 honors topics.getCurrentFanState', () => {
  it('creates CurrentFanState from the correct topics key', () => {
    const { accessory } = makeAccessory(
      {
        type: 'fanv2',
        name: 'F15a',
        topics: { setActive: 't/f15a/set', getCurrentFanState: 't/f15a/fanstate' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Fanv2)!;
    expect(svc.testCharacteristic(Characteristic.CurrentFanState)).toBe(true);
    dispatchTo(accessory, 't/f15a/fanstate', 'BLOWING_AIR');
    expect(svc.getCharacteristic(Characteristic.CurrentFanState).value).toBe(
      Characteristic.CurrentFanState.BLOWING_AIR,
    );
  });

  it('still honors the legacy top-level key', () => {
    const { accessory } = makeAccessory(
      {
        type: 'fanv2',
        name: 'F15b',
        getCurrentFanState: 'legacy-truthy',
        topics: { setActive: 't/f15b/set' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Fanv2)!;
    expect(svc.testCharacteristic(Characteristic.CurrentFanState)).toBe(true);
  });
});

describe('F7: null-safe pipelines (#438, #458)', () => {
  it('suppresses messages when apply() decode returns null', () => {
    const { ctx, dispatch } = makeCtx();
    const received: unknown[] = [];
    subscribe(ctx, { topic: 'in', apply: 'if( message == "keep" ) { return message; } return null;' }, 'p', (_t, m) =>
      received.push(m),
    );
    dispatch('in', 'drop');
    dispatch('in', 'keep');
    expect(received).toEqual(['keep']);
  });

  it('suppresses codec decode results of null', () => {
    const { ctx, dispatch } = makeCtx();
    ctx.codec = {
      decode: (message) => (String(message) === 'keep' ? message : null),
      encode: null,
    };
    const received: unknown[] = [];
    subscribe(ctx, 'in', 'p', (_t, m) => received.push(m));
    dispatch('in', 'drop');
    dispatch('in', 'keep');
    expect(received).toEqual(['keep']);
  });

  it('never publishes literal null/undefined from codec encode output()', () => {
    const { ctx, published } = makeCtx();
    ctx.codec = {
      decode: null,
      // codec delivering null asynchronously through output() crashed upstream
      encode: (_message, _info, output) => {
        output(null);
        output(undefined);
        output('real');
      },
    };
    publish(ctx, 't', 'p', 'x');
    expect(published.map((p) => p.message)).toEqual(['real']);
  });
});
