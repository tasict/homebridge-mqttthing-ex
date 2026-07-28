// The editor computes HomeKit UUIDs itself (crypto.subtle is unavailable
// over plain HTTP). These tests hold that implementation to the real thing:
// every value must match hap-nodejs, which is what Homebridge uses.
import { createHash } from 'node:crypto';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import { describe, expect, it } from 'vitest';

import { isUuid } from '../src/model/identity.js';
import { accessoryUuid, hapUuidFrom, randomUuid, sha1Hex } from '../ui/src/lib/hap-uuid.js';

const SAMPLES = [
  '',
  'a',
  'Sw1',
  'Living Room Light',
  '客廳燈',
  'Ünïcödé näme',
  'mqttthing:Living Room Light',
  'x'.repeat(55), // one byte short of a padding block
  'x'.repeat(56), // forces a second padding block
  'x'.repeat(64),
  'x'.repeat(200),
  'emoji 🎛️ name',
];

describe('sha1Hex', () => {
  it('matches node crypto for ASCII, unicode and block boundaries', () => {
    for (const sample of SAMPLES) {
      expect(sha1Hex(sample), `sha1 of ${JSON.stringify(sample)}`).toBe(
        createHash('sha1').update(sample).digest('hex'),
      );
    }
  });
});

describe('hapUuidFrom', () => {
  it('matches hap-nodejs uuid.generate', () => {
    for (const sample of SAMPLES) {
      expect(hapUuidFrom(sample), `uuid of ${JSON.stringify(sample)}`).toBe(hapNodeJs.uuid.generate(sample));
    }
  });
});

describe('accessoryUuid', () => {
  it('reproduces the UUID Homebridge gives an accessory of that name', () => {
    expect(accessoryUuid('Living Room Light')).toBe(hapNodeJs.uuid.generate('mqttthing:Living Room Light'));
  });

  it('reproduces a UUID observed from a real Homebridge run', () => {
    // taken from the identifier cache of an accessory-mode instance
    expect(accessoryUuid('EX Test Switch')).toBe('27f5c75e-9541-4e0a-b614-6119e3add6e1');
    expect(accessoryUuid('EX Test Light')).toBe('6698ccdd-93bc-4303-a8cf-f075975218c0');
    expect(accessoryUuid('EX Test Combo')).toBe('28937902-e244-4e86-922f-b4b98ae1efbf');
  });

  it('produces values hap-nodejs itself considers valid', () => {
    expect(hapNodeJs.uuid.isValid(accessoryUuid('anything'))).toBe(true);
  });
});

describe('isUuid', () => {
  it('accepts UUIDs in either case and rejects everything else', () => {
    expect(isUuid('27f5c75e-9541-4e0a-b614-6119e3add6e1')).toBe(true);
    expect(isUuid('27F5C75E-9541-4E0A-B614-6119E3ADD6E1')).toBe(true);
    expect(isUuid('Living Room Light')).toBe(false);
    expect(isUuid('27f5c75e95414e0ab6146119e3add6e1')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('agrees with hap-nodejs', () => {
    for (const value of ['27f5c75e-9541-4e0a-b614-6119e3add6e1', 'nope', '']) {
      expect(isUuid(value)).toBe(hapNodeJs.uuid.isValid(value));
    }
  });
});

describe('randomUuid', () => {
  it('produces distinct, valid v4 UUIDs', () => {
    const values = new Set(Array.from({ length: 200 }, () => randomUuid()));
    expect(values.size).toBe(200);
    for (const value of values) {
      expect(isUuid(value)).toBe(true);
      expect(value[14]).toBe('4');
      expect('89ab').toContain(value[19]);
    }
  });
});
