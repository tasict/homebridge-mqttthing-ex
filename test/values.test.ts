import { describe, expect, it } from 'vitest';

import type { ThingConfig } from '../src/config.js';
import {
  getOnOffPubValue,
  getOnlineOfflinePubValue,
  isRecvValueOff,
  isRecvValueOn,
} from '../src/hap/values.js';

function cfg(partial: Partial<ThingConfig> = {}): ThingConfig {
  return { accessory: 'mqttthing', type: 'switch', name: 'x', ...partial } as ThingConfig;
}

describe('on/off value mapping', () => {
  it('defaults to booleans', () => {
    expect(getOnOffPubValue(cfg(), true)).toBe(true);
    expect(getOnOffPubValue(cfg(), false)).toBe(false);
  });

  it('uses 1/0 with integerValue', () => {
    expect(getOnOffPubValue(cfg({ integerValue: true }), true)).toBe(1);
    expect(getOnOffPubValue(cfg({ integerValue: true }), false)).toBe(0);
  });

  it('uses onValue/offValue when configured', () => {
    const c = cfg({ onValue: 'ON', offValue: 'OFF' });
    expect(getOnOffPubValue(c, true)).toBe('ON');
    expect(getOnOffPubValue(c, false)).toBe('OFF');
  });

  it('returns null for off when only onValue is configured (no off publish)', () => {
    expect(getOnOffPubValue(cfg({ onValue: 'ON' }), false)).toBeNull();
  });

  it('falls through to integerValue when onValue is falsy (upstream truthiness gate)', () => {
    const c = cfg({ onValue: 0 as unknown as string, integerValue: true });
    expect(getOnOffPubValue(c, true)).toBe(1);
  });

  it('matches received on-values loosely', () => {
    expect(isRecvValueOn(cfg(), 'true')).toBe(true);
    expect(isRecvValueOn(cfg(), Buffer.from('true'))).toBe(true);
    expect(isRecvValueOn(cfg({ integerValue: true }), '1')).toBe(true);
    expect(isRecvValueOn(cfg({ onValue: 'ON' }), 'ON')).toBe(true);
    expect(isRecvValueOn(cfg(), 'nope')).toBe(false);
  });

  it('only accepts exact off matches unless otherValueOff is set', () => {
    const c = cfg({ onValue: 'ON', offValue: 'OFF' });
    expect(isRecvValueOff(c, 'OFF')).toBe(true);
    expect(isRecvValueOff(c, 'anything')).toBe(false);
    // no offValue -> nothing counts as off
    const noOff = cfg({ onValue: 'ON' });
    expect(isRecvValueOff(noOff, 'OFF')).toBe(false);
    // otherValueOff restores any-non-on-is-off
    const other = cfg({ onValue: 'ON', otherValueOff: true });
    expect(isRecvValueOff(other, 'whatever')).toBe(true);
    expect(isRecvValueOff(other, 'ON')).toBe(false);
  });

  it('matches the numbers 1/0 against Boolean on/off values', () => {
    // apply() decoding to the HomeKit value of Active/InUse (issue #1)
    expect(isRecvValueOn(cfg(), 1)).toBe(true);
    expect(isRecvValueOff(cfg(), 0)).toBe(true);
    expect(isRecvValueOn(cfg(), 0)).toBe(false);
    expect(isRecvValueOff(cfg(), 1)).toBe(false);
    expect(isRecvValueOn(cfg(), 2)).toBe(false);
    expect(isRecvValueOff(cfg(), 2)).toBe(false);
    // received strings keep upstream semantics
    expect(isRecvValueOn(cfg(), '1')).toBe(false);
    expect(isRecvValueOff(cfg(), '0')).toBe(false);
    // configured onValue/offValue are not widened
    const c = cfg({ onValue: 'ON', offValue: 'OFF' });
    expect(isRecvValueOn(c, 1)).toBe(false);
    expect(isRecvValueOff(c, 0)).toBe(false);
    // otherValueOff no longer turns a numeric 1 into off
    expect(isRecvValueOff(cfg({ otherValueOff: true }), 1)).toBe(false);
  });

  it('online/offline values default to on/off values', () => {
    expect(getOnlineOfflinePubValue(cfg(), true)).toBe(true);
    const c = cfg({ onlineValue: 'UP', offlineValue: 'DOWN' });
    expect(getOnlineOfflinePubValue(c, true)).toBe('UP');
    expect(getOnlineOfflinePubValue(c, false)).toBe('DOWN');
  });
});
