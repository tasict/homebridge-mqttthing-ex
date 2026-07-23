import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../src/mqtt/wiring.js';
import { makeCtx, makeTestLog } from './helpers.js';
import { PublishQueue } from '../src/mqtt/queue.js';

describe('PublishQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeQueue(opts: { interval?: number; limit?: number; coalesce?: boolean } = {}) {
    const sent: Array<{ topic: string; message: string; at: number }> = [];
    const { log, messages } = makeTestLog();
    const start = Date.now();
    const queue = new PublishQueue(
      (topic, message) => sent.push({ topic, message, at: Date.now() - start }),
      opts.interval ?? 100,
      opts.limit ?? 1000,
      opts.coalesce ?? true,
      log,
    );
    return { queue, sent, messages };
  }

  it('sends the first message synchronously when idle', () => {
    const { queue, sent } = makeQueue();
    queue.enqueue('t', '1');
    expect(sent).toEqual([{ topic: 't', message: '1', at: 0 }]);
  });

  it('paces subsequent messages by the minimum interval', () => {
    const { queue, sent } = makeQueue({ interval: 100 });
    queue.enqueue('a', '1');
    queue.enqueue('b', '2');
    queue.enqueue('c', '3');
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(3);
    expect(sent.map((s) => s.at)).toEqual([0, 100, 200]);
    expect(sent.map((s) => s.topic)).toEqual(['a', 'b', 'c']);
  });

  it('coalesces queued messages for the same topic (latest wins)', () => {
    const { queue, sent } = makeQueue({ interval: 100 });
    queue.enqueue('bri', '10'); // sent immediately
    queue.enqueue('bri', '20');
    queue.enqueue('bri', '55');
    queue.enqueue('bri', '90');
    vi.advanceTimersByTime(1000);
    expect(sent.map((s) => s.message)).toEqual(['10', '90']);
  });

  it('keeps FIFO order across different topics while coalescing', () => {
    const { queue, sent } = makeQueue({ interval: 100 });
    queue.enqueue('a', '1'); // immediate
    queue.enqueue('b', '1');
    queue.enqueue('c', '1');
    queue.enqueue('b', '2'); // replaces queued b in place
    vi.advanceTimersByTime(1000);
    expect(sent.map((s) => `${s.topic}=${s.message}`)).toEqual(['a=1', 'b=2', 'c=1']);
  });

  it('preserves every message when coalescing is disabled', () => {
    const { queue, sent } = makeQueue({ interval: 50, coalesce: false });
    queue.enqueue('t', '1');
    queue.enqueue('t', '2');
    queue.enqueue('t', '3');
    vi.advanceTimersByTime(1000);
    expect(sent.map((s) => s.message)).toEqual(['1', '2', '3']);
  });

  it('drops the oldest message and warns when the queue limit is reached', () => {
    const { queue, sent, messages } = makeQueue({ interval: 100, limit: 2, coalesce: false });
    queue.enqueue('t', '1'); // sent immediately, not queued
    queue.enqueue('t', '2');
    queue.enqueue('t', '3');
    queue.enqueue('t', '4'); // exceeds limit of 2 -> drops '2'
    vi.advanceTimersByTime(1000);
    expect(sent.map((s) => s.message)).toEqual(['1', '3', '4']);
    expect(messages.some((m) => m.includes('Publish queue full'))).toBe(true);
  });

  it('resumes pacing relative to the last send after an idle gap', () => {
    const { queue, sent } = makeQueue({ interval: 100 });
    queue.enqueue('a', '1');
    vi.advanceTimersByTime(30);
    queue.enqueue('b', '2'); // only 30ms since last send -> waits 70ms
    vi.advanceTimersByTime(69);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(2);
    // after a long idle period the next message is immediate again
    vi.advanceTimersByTime(500);
    queue.enqueue('c', '3');
    expect(sent).toHaveLength(3);
  });
});

describe('publish() with queue enabled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('routes publishes through the queue when publishMinIntervalms is set', () => {
    const { ctx, published } = makeCtx({ publishMinIntervalms: 100 });
    publish(ctx, 'sw/set', 'on', 'true');
    publish(ctx, 'sw/bri', 'brightness', 10);
    publish(ctx, 'sw/bri', 'brightness', 90);
    expect(published).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(published.map((p) => `${p.topic}=${p.message}`)).toEqual(['sw/set=true', 'sw/bri=90']);
  });

  it('behaves identically to upstream when not configured', () => {
    const { ctx, published } = makeCtx();
    publish(ctx, 'sw/set', 'on', 'true');
    publish(ctx, 'sw/set', 'on', 'false');
    // synchronous, unpaced, no coalescing
    expect(published.map((p) => p.message)).toEqual(['true', 'false']);
  });
});
