import { describe, expect, it, vi } from 'vitest';

import { loadCodec, makeCodecPath } from '../src/codec/loader.js';
import { publish, subscribe } from '../src/mqtt/wiring.js';
import { makeCtx, makeTestLog, repoRoot, upstreamTestDir } from './helpers.js';
import path from 'node:path';

describe('publish pipeline', () => {
  it('publishes a plain string topic as-is', () => {
    const { ctx, published } = makeCtx();
    publish(ctx, 'device/set', 'on', true);
    expect(published).toEqual([{ topic: 'device/set', message: 'true', opts: {} }]);
  });

  it('does not publish null messages or undefined topics', () => {
    const { ctx, published } = makeCtx();
    publish(ctx, 'device/set', 'on', null);
    publish(ctx, undefined, 'on', 'x');
    expect(published).toHaveLength(0);
  });

  it('passes mqttPubOptions through verbatim', () => {
    const { ctx, published } = makeCtx({ mqttPubOptions: { retain: true, qos: 1 } });
    publish(ctx, 't', 'on', 1);
    expect(published[0].opts).toEqual({ retain: true, qos: 1 });
  });

  it('applies the apply() encode function of an extended topic', () => {
    const { ctx, published } = makeCtx();
    publish(ctx, { topic: 't', apply: 'return message * 2;' }, 'brightness', 21);
    expect(published).toEqual([{ topic: 't', message: '42', opts: {} }]);
  });

  it('suppresses publishing when apply() returns null/undefined or throws', () => {
    const { ctx, published, messages } = makeCtx();
    publish(ctx, { topic: 't', apply: 'return null;' }, 'p', 1);
    publish(ctx, { topic: 't', apply: 'return undefined;' }, 'p', 1);
    publish(ctx, { topic: 't', apply: 'throw new Error("nope");' }, 'p', 1);
    expect(published).toHaveLength(0);
    expect(messages.some((m) => m.includes('failed for topic t'))).toBe(true);
  });

  it('keeps per-property apply state with shared global', () => {
    const { ctx, published } = makeCtx();
    const spec = { topic: 't', apply: 'state.n = (state.n || 0) + 1; state.global.total = (state.global.total || 0) + 1; return state.n;' };
    publish(ctx, spec, 'a', 0);
    publish(ctx, spec, 'a', 0);
    // different property gets fresh per-property state but shares global
    publish(ctx, { topic: 't2', apply: 'return state.global.total;' }, 'b', 0);
    expect(published.map((p) => p.message)).toEqual(['1', '2', '2']);
  });

  it('optimizePublishing suppresses repeated values per topic', () => {
    const { ctx, published } = makeCtx({ optimizePublishing: true });
    publish(ctx, 't', 'on', 'true');
    publish(ctx, 't', 'on', 'true');
    publish(ctx, 't', 'on', 'false');
    publish(ctx, 't2', 'on', 'true');
    expect(published.map((p) => `${p.topic}=${p.message}`)).toEqual(['t=true', 't=false', 't2=true']);
  });
});

describe('subscribe pipeline', () => {
  it('subscribes and dispatches raw messages', () => {
    const { ctx, subscribed, dispatch } = makeCtx();
    const received: unknown[] = [];
    subscribe(ctx, 'device/get', 'on', (_t, m) => received.push(m));
    expect(subscribed).toEqual(['device/get']);
    dispatch('device/get', Buffer.from('true'));
    expect(String(received[0])).toBe('true');
  });

  it('only subscribes once per topic but calls every handler', () => {
    const { ctx, subscribed, dispatch } = makeCtx();
    const a: unknown[] = [];
    const b: unknown[] = [];
    subscribe(ctx, 'shared', 'p1', (_t, m) => a.push(m));
    subscribe(ctx, 'shared', 'p2', (_t, m) => b.push(m));
    expect(subscribed).toEqual(['shared']);
    dispatch('shared', '1');
    expect(a).toEqual(['1']);
    expect(b).toEqual(['1']);
  });

  it('applies the apply() decode function with message and state in scope', () => {
    const { ctx, dispatch } = makeCtx();
    const received: unknown[] = [];
    subscribe(ctx, { topic: 'in', apply: 'return JSON.parse(message).value;' }, 'p', (_t, m) => received.push(m));
    dispatch('in', Buffer.from('{"value": 7}'));
    expect(received).toEqual([7]);
  });

  it('suppresses messages when apply() decode returns undefined', () => {
    const { ctx, dispatch } = makeCtx();
    const received: unknown[] = [];
    subscribe(ctx, { topic: 'in', apply: 'if( message == "keep" ) { return message; }' }, 'p', (_t, m) =>
      received.push(m),
    );
    dispatch('in', 'drop');
    dispatch('in', 'keep');
    expect(received).toEqual(['keep']);
  });

  it('extracts values via a JSONPath topic suffix', () => {
    const { ctx, subscribed, dispatch } = makeCtx();
    const received: unknown[] = [];
    subscribe(ctx, 'tele/SENSOR$.AM2301.Temperature', 'temperature', (_t, m) => received.push(m));
    // subscribes to the base topic only
    expect(subscribed).toEqual(['tele/SENSOR']);
    dispatch('tele/SENSOR', Buffer.from('{"AM2301":{"Temperature":21.5}}'));
    expect(received).toEqual([21.5]);
  });

  it('debounces received messages when debounceRecvms is set', () => {
    vi.useFakeTimers();
    try {
      const { ctx, dispatch } = makeCtx({ debounceRecvms: 100 });
      const received: unknown[] = [];
      subscribe(ctx, 'in', 'p', (_t, m) => received.push(m));
      dispatch('in', '1');
      dispatch('in', '2');
      dispatch('in', '3');
      expect(received).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(received).toEqual(['3']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('codec integration', () => {
  it('resolves codec paths using the three upstream rules', () => {
    expect(makeCodecPath('/abs/path/codec.js', '/hb')).toBe('/abs/path/codec.js');
    expect(makeCodecPath('json', '/hb')).toBe(path.join(repoRoot, 'codecs', 'json.js'));
    expect(makeCodecPath('my-codec.js', '/hb')).toBe(path.join('/hb', 'my-codec.js'));
  });

  it('reports a missing codec file like upstream', () => {
    const { log, messages } = makeTestLog();
    const codec = loadCodec('nope-does-not-exist.js', '/tmp', {
      log,
      config: { accessory: 'mqttthing', type: 'switch', name: 'x' },
      publish: () => {},
      notify: () => {},
    });
    expect(codec).toBeNull();
    expect(messages.some((m) => m.includes('Codec file [') && m.includes('does not exist'))).toBe(true);
  });

  it('uses per-property codec functions with default fallback (upstream test-codec.js)', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, published, dispatch } = makeCtx();
      ctx.codec = loadCodec('test-codec.js', upstreamTestDir, {
        log: ctx.log,
        config: ctx.config,
        publish: () => {},
        notify: () => {},
      });
      expect(ctx.codec).not.toBeNull();

      // default encode delays via output() by 1000ms
      publish(ctx, 'sw/set', 'on', 'true');
      expect(published).toHaveLength(0);
      vi.advanceTimersByTime(1000);
      expect(published).toEqual([{ topic: 'sw/set', message: 'true', opts: {} }]);

      // per-property brightness encode scales 0-100 -> 0-255 synchronously
      // (Math.floor(100 * 2.55) === 254 due to floating point, as upstream)
      publish(ctx, 'sw/bri', 'brightness', 100);
      expect(published[1]).toEqual({ topic: 'sw/bri', message: '254', opts: {} });

      // per-property brightness decode scales back down
      const received: unknown[] = [];
      subscribe(ctx, 'sw/briState', 'brightness', (_t, m) => received.push(m));
      dispatch('sw/briState', 255);
      expect(received).toEqual([100]);

      // default decode delays by 500ms
      const onReceived: unknown[] = [];
      subscribe(ctx, 'sw/state', 'on', (_t, m) => onReceived.push(m));
      dispatch('sw/state', 'true');
      expect(onReceived).toEqual([]);
      vi.advanceTimersByTime(500);
      expect(onReceived).toEqual(['true']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delivers codec notify() through the property dispatch, bypassing decode', () => {
    const { ctx, dispatch } = makeCtx();
    let notifyFn: ((property: string, message: unknown) => void) | null = null;
    // emulate client.init()'s notify wiring
    const notify = (property: string, message: unknown) => {
      const handlers = ctx.propDispatch[property];
      if (handlers) {
        for (const h of handlers) {
          h('_prop-' + property, message);
        }
      }
    };
    ctx.codec = loadCodec('empty-codec.js', upstreamTestDir, {
      log: ctx.log,
      config: ctx.config,
      publish: () => {},
      notify: (notifyFn = notify),
    });
    expect(ctx.codec).not.toBeNull();

    const received: unknown[] = [];
    subscribe(ctx, 'sw/state', 'on', (_t, m) => received.push(m));
    // notify bypasses the codec decode chain and hits the raw handler
    notifyFn!('on', 'direct');
    expect(received).toEqual(['direct']);
    // regular dispatch still works
    dispatch('sw/state', 'via-mqtt');
    expect(received).toContain('via-mqtt');
  });
});
