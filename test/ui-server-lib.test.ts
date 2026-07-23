// Unit tests for the custom UI server handlers (homebridge-ui/server-lib.mjs)
// using injected fakes for fs and mqtt; server.js itself is a thin shell.
import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

// @ts-expect-error plain-JS module without type declarations
import { BUILT_IN_CODECS, listCodecs, normalizeBrokerUrl, probeTopic, testMqttConnection } from '../homebridge-ui/server-lib.mjs';

interface FakeDirent {
  name: string;
  isFile: () => boolean;
}

function dirent(name: string, file = true): FakeDirent {
  return { name, isFile: () => file };
}

class FakeMqttClient extends EventEmitter {
  ended = false;
  subscriptions: string[] = [];
  subscribeError: Error | null = null;

  subscribe(topic: string, callback: (err: Error | null) => void) {
    this.subscriptions.push(topic);
    callback(this.subscribeError);
  }

  end(_force?: boolean) {
    this.ended = true;
  }
}

describe('server-lib: /codecs listing', () => {
  it('lists bundled codecs plus *.js files in the storage path (sorted)', async () => {
    const readdir = async (path: string) => {
      expect(path).toBe('/storage');
      return [
        dirent('zeta-codec.js'),
        dirent('alpha-codec.js'),
        dirent('notes.txt'),
        dirent('subdir.js', false), // directory named like a codec
        dirent('config.json'),
      ];
    };
    const result = await listCodecs(readdir, '/storage');
    expect(result.builtIn).toEqual(['json', 'shellyAMAX']);
    expect(result.builtIn).toEqual(BUILT_IN_CODECS);
    expect(result.custom).toEqual(['alpha-codec.js', 'zeta-codec.js']);
  });

  it('returns an empty custom list when the directory cannot be read', async () => {
    const readdir = async () => {
      throw new Error('EACCES');
    };
    const result = await listCodecs(readdir, '/storage');
    expect(result.builtIn).toEqual(BUILT_IN_CODECS);
    expect(result.custom).toEqual([]);
  });
});

describe('server-lib: broker URL normalization', () => {
  it('matches the runtime rules', () => {
    expect(normalizeBrokerUrl('mqtt://host:1883')).toBe('mqtt://host:1883');
    expect(normalizeBrokerUrl('host:1883')).toBe('mqtt://host:1883');
    expect(normalizeBrokerUrl('  host ')).toBe('mqtt://host');
    expect(normalizeBrokerUrl('')).toBe('mqtt://localhost:1883');
    expect(normalizeBrokerUrl(undefined)).toBe('mqtt://localhost:1883');
  });
});

describe('server-lib: /mqtt/test', () => {
  it('resolves ok on connect and passes credentials through', async () => {
    let seenUrl = '';
    let seenOptions: Record<string, unknown> = {};
    const client = new FakeMqttClient();
    const connect = (url: string, options: Record<string, unknown>) => {
      seenUrl = url;
      seenOptions = options;
      queueMicrotask(() => client.emit('connect'));
      return client;
    };
    const result = await testMqttConnection(connect, { url: 'broker.local', username: 'u', password: 'p' }, 1000);
    expect(result).toEqual({ ok: true });
    expect(seenUrl).toBe('mqtt://broker.local');
    expect(seenOptions.username).toBe('u');
    expect(seenOptions.password).toBe('p');
    expect(seenOptions.reconnectPeriod).toBe(0);
    expect(client.ended).toBe(true);
  });

  it('reports connection errors', async () => {
    const client = new FakeMqttClient();
    const connect = () => {
      queueMicrotask(() => client.emit('error', new Error('Connection refused')));
      return client;
    };
    const result = await testMqttConnection(connect, { url: 'mqtt://x' }, 1000);
    expect(result).toEqual({ ok: false, message: 'Connection refused' });
    expect(client.ended).toBe(true);
  });

  it('times out when the broker never answers', async () => {
    const client = new FakeMqttClient(); // never emits anything
    const result = await testMqttConnection(() => client, { url: 'mqtt://silent' }, 30);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('timed out');
    expect(client.ended).toBe(true);
  });

  it('reports synchronous connect() failures', async () => {
    const connect = () => {
      throw new Error('bad url');
    };
    const result = await testMqttConnection(connect, { url: '::::' }, 1000);
    expect(result).toEqual({ ok: false, message: 'bad url' });
  });
});

describe('server-lib: /mqtt/probe', () => {
  it('subscribes, forwards messages and resolves with the count at the end of the window', async () => {
    const client = new FakeMqttClient();
    const connect = () => {
      queueMicrotask(() => {
        client.emit('connect');
        client.emit('message', 'home/temp', Buffer.from('21.5'));
        client.emit('message', 'home/temp', Buffer.from('21.7'));
      });
      return client;
    };
    const received: Array<{ topic: string; message: string }> = [];
    const result = await probeTopic(
      connect,
      { url: 'mqtt://x', topic: 'home/temp' },
      (topic: string, message: string) => received.push({ topic, message }),
      50,
    );
    expect(result).toEqual({ ok: true, count: 2 });
    expect(client.subscriptions).toEqual(['home/temp']);
    expect(received).toEqual([
      { topic: 'home/temp', message: '21.5' },
      { topic: 'home/temp', message: '21.7' },
    ]);
    expect(client.ended).toBe(true);
  });

  it('rejects an empty topic without connecting', async () => {
    let connected = false;
    const connect = () => {
      connected = true;
      return new FakeMqttClient();
    };
    const result = await probeTopic(connect, { url: 'mqtt://x', topic: '  ' }, () => undefined, 50);
    expect(result.ok).toBe(false);
    expect(connected).toBe(false);
  });

  it('reports subscription failures', async () => {
    const client = new FakeMqttClient();
    client.subscribeError = new Error('not authorized');
    const connect = () => {
      queueMicrotask(() => client.emit('connect'));
      return client;
    };
    const result = await probeTopic(connect, { url: 'mqtt://x', topic: 't' }, () => undefined, 1000);
    expect(result).toEqual({ ok: false, message: 'not authorized' });
    expect(client.ended).toBe(true);
  });
});
