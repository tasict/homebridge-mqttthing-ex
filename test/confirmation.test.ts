import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeConfirmedPublisher } from '../src/mqtt/confirmation.js';
import { makeCtx } from './helpers.js';

describe('makeConfirmedPublisher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a plain publisher when confirmation is not configured', () => {
    const { ctx, published, subscribed } = makeCtx();
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    expect(subscribed).toEqual([]); // no confirmation subscription
    pub('true');
    expect(published).toEqual([{ topic: 'sw/set', message: 'true', opts: {} }]);
  });

  it('returns a plain publisher when makeConfirmed is false even with confirmationPeriodms', () => {
    const { ctx, published, subscribed } = makeCtx({ confirmationPeriodms: 1000 });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', false);
    expect(subscribed).toEqual([]);
    pub('x');
    expect(published).toHaveLength(1);
  });

  it('confirms on echo and stays online', () => {
    const { ctx, published, dispatch } = makeCtx({ confirmationPeriodms: 1000, topics: {} });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    expect(published).toHaveLength(1);
    dispatch('sw/get', 'true'); // device echoes
    vi.advanceTimersByTime(5000);
    expect(published).toHaveLength(1); // no retries
    expect(ctx.state.online).toBeUndefined(); // never marked offline
  });

  it('retries up to the default limit of 3 and marks offline', () => {
    const { ctx, published, messages } = makeCtx({ confirmationPeriodms: 1000, topics: {} });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    vi.advanceTimersByTime(4000);
    // initial + 3 retries
    expect(published).toHaveLength(4);
    expect(ctx.state.online).toBe(false);
    expect(messages.some((m) => m.includes('Unresponsive'))).toBe(true);
  });

  it('honors a configured retryLimit', () => {
    const { ctx, published } = makeCtx({ confirmationPeriodms: 1000, retryLimit: 1, topics: {} });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    vi.advanceTimersByTime(10000);
    expect(published).toHaveLength(2); // initial + 1 retry
  });

  it('recovers online state when the device echoes after being marked offline', () => {
    const { ctx, dispatch } = makeCtx({ confirmationPeriodms: 1000, topics: {} });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    vi.advanceTimersByTime(4000);
    expect(ctx.state.online).toBe(false);
    dispatch('sw/get', 'true');
    expect(ctx.state.online).toBe(true);
  });

  it('does not mark offline when a getOnline topic exists (default tri-state)', () => {
    const { ctx } = makeCtx({ confirmationPeriodms: 1000, topics: { getOnline: 'sw/online' } });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    vi.advanceTimersByTime(10000);
    expect(ctx.state.online).toBeUndefined();
  });

  it('marks offline despite getOnline when confirmationIndicateOffline is true', () => {
    const { ctx } = makeCtx({
      confirmationPeriodms: 1000,
      confirmationIndicateOffline: true,
      topics: { getOnline: 'sw/online' },
    });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    vi.advanceTimersByTime(10000);
    expect(ctx.state.online).toBe(false);
  });

  it('never marks offline when confirmationIndicateOffline is false', () => {
    const { ctx } = makeCtx({ confirmationPeriodms: 1000, confirmationIndicateOffline: false, topics: {} });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub('true');
    vi.advanceTimersByTime(10000);
    expect(ctx.state.online).toBeUndefined();
  });

  it('matches numeric echoes loosely like upstream (message == expected + "")', () => {
    const { ctx, published, dispatch } = makeCtx({ confirmationPeriodms: 1000, topics: {} });
    const pub = makeConfirmedPublisher(ctx, 'sw/set', 'sw/get', 'on', true);
    pub(1);
    dispatch('sw/get', '1'); // string echo of numeric publish
    vi.advanceTimersByTime(5000);
    expect(published).toHaveLength(1); // confirmed, no retry
  });
});
