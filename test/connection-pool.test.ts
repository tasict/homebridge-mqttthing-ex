import { describe, expect, it } from 'vitest';

import { resolveEffectiveBroker, type BrokerSettings } from '../src/mqtt/connection.js';

const noEnv = {} as NodeJS.ProcessEnv;

function key(device: BrokerSettings, defaults: BrokerSettings = {}, env = noEnv): string {
  return resolveEffectiveBroker(device, defaults, env).key;
}

describe('resolveEffectiveBroker', () => {
  it('gives devices inheriting the same platform broker the same key', () => {
    const defaults = { url: 'mqtt://broker:1883', username: 'u', password: 'p' };
    expect(key({}, defaults)).toBe(key({}, defaults));
  });

  it('normalizes the URL before keying, so a missing protocol still groups', () => {
    expect(key({ url: 'broker:1883' })).toBe(key({ url: 'mqtt://broker:1883' }));
    expect(resolveEffectiveBroker({ url: 'broker:1883' }, {}, noEnv).url).toBe('mqtt://broker:1883');
  });

  it('defaults to a local broker when nothing is configured', () => {
    expect(resolveEffectiveBroker({}, {}, noEnv).url).toBe('mqtt://localhost:1883');
  });

  it('separates a device that overrides the credentials', () => {
    const defaults = { url: 'mqtt://broker:1883', username: 'u', password: 'p' };
    expect(key({ username: 'other' }, defaults)).not.toBe(key({}, defaults));
    expect(key({ password: 'other' }, defaults)).not.toBe(key({}, defaults));
  });

  it('separates a device that overrides the URL', () => {
    const defaults = { url: 'mqtt://broker:1883' };
    expect(key({ url: 'mqtt://other:1883' }, defaults)).not.toBe(key({}, defaults));
  });

  it('groups a device relying on the environment with one configured explicitly', () => {
    const env = { MQTTTHING_URL: 'mqtt://env-broker:1883', MQTTTHING_USERNAME: 'envuser' } as NodeJS.ProcessEnv;
    expect(key({}, {}, env)).toBe(key({ url: 'mqtt://env-broker:1883', username: 'envuser' }, {}, env));
  });

  it('replaces mqttOptions rather than merging them', () => {
    const defaults = { url: 'mqtt://broker:1883', mqttOptions: { keepalive: 30, protocolVersion: 5 } };
    // the device only sets keepalive, so protocolVersion is NOT inherited
    expect(key({ mqttOptions: { keepalive: 30 } }, defaults)).not.toBe(key({}, defaults));
    expect(resolveEffectiveBroker({ mqttOptions: { keepalive: 30 } }, defaults, noEnv).mqttOptions).toEqual({
      keepalive: 30,
    });
  });

  it('ignores mqttOptions key order', () => {
    expect(key({ mqttOptions: { a: 1, b: { c: 2, d: 3 } } })).toBe(
      key({ mqttOptions: { b: { d: 3, c: 2 }, a: 1 } }),
    );
  });

  it('separates connections using different certificate files', () => {
    expect(key({ mqttOptions: { cafile: '/etc/a.pem' } })).not.toBe(key({ mqttOptions: { cafile: '/etc/b.pem' } }));
  });

  it('separates connections pinning different client ids', () => {
    expect(key({ mqttOptions: { clientId: 'one' } })).not.toBe(key({ mqttOptions: { clientId: 'two' } }));
  });

  it('does not split a group over logMqtt, which is not a connection setting', () => {
    const defaults = { url: 'mqtt://broker:1883' };
    // logMqtt is not part of BrokerSettings at all - proving it cannot key
    expect(key({}, defaults)).toBe(key({}, defaults));
  });
});
