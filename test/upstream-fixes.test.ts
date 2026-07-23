// Tests for upstream-issue fixes carried by the rewrite
// (see docs/UpstreamIssues.md).
import { describe, expect, it } from 'vitest';

import { publish, subscribe, topicFilterMatches } from '../src/mqtt/wiring.js';
import { makeCtx } from './helpers.js';

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
