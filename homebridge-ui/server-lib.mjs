// Pure handler logic for the custom UI server (homebridge-ui/server.js).
// Every I/O dependency (fs readdir, mqtt connect) is injected so the
// functions can be unit-tested with fakes; server.js stays a thin shell.

/** Codec names bundled with the plugin (see codecs/). */
export const BUILT_IN_CODECS = ['json', 'shellyAMAX'];

/**
 * List the codecs available to this Homebridge instance: the bundled codec
 * names plus every *.js file directly inside the Homebridge storage path
 * (the only directory user codecs are resolved against; nothing else is
 * ever read).
 *
 * @param {(path: string, options: { withFileTypes: true }) => Promise<import('node:fs').Dirent[]>} readdir
 * @param {string} storagePath
 */
export async function listCodecs(readdir, storagePath) {
  let custom = [];
  try {
    const entries = await readdir(storagePath, { withFileTypes: true });
    custom = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    custom = [];
  }
  return { builtIn: [...BUILT_IN_CODECS], custom };
}

/**
 * Broker URL normalization matching the runtime: a missing scheme gets
 * 'mqtt://' prepended; an empty URL falls back to localhost.
 */
export function normalizeBrokerUrl(url) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (trimmed === '') {
    return 'mqtt://localhost:1883';
  }
  return trimmed.includes('://') ? trimmed : `mqtt://${trimmed}`;
}

function connectionOptions({ username, password }, timeoutMs) {
  const options = {
    connectTimeout: timeoutMs,
    reconnectPeriod: 0, // one attempt only; the UI initiates retries
  };
  if (typeof username === 'string' && username !== '') {
    options.username = username;
  }
  if (typeof password === 'string' && password !== '') {
    options.password = password;
  }
  return options;
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Try to connect to an MQTT broker. Resolves (never rejects) with
 * { ok: true } or { ok: false, message } after at most timeoutMs.
 *
 * @param {(url: string, options: object) => import('mqtt').MqttClient} connect
 * @param {{ url?: string, username?: string, password?: string }} payload
 * @param {number} [timeoutMs]
 */
export function testMqttConnection(connect, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let client;
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        client?.end(true);
      } catch {
        // ignore teardown errors
      }
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, message: `Connection timed out after ${timeoutMs} ms` }),
      timeoutMs,
    );
    try {
      client = connect(normalizeBrokerUrl(payload.url), connectionOptions(payload, timeoutMs));
    } catch (e) {
      finish({ ok: false, message: errorMessage(e) });
      return;
    }
    client.on('connect', () => finish({ ok: true }));
    client.on('error', (err) => finish({ ok: false, message: errorMessage(err) }));
  });
}

/**
 * Subscribe to one topic for a few seconds, forwarding every received
 * message to onMessage(topic, payloadString). Resolves (never rejects)
 * with { ok: true, count } when the listening window ends, or
 * { ok: false, message } on connection/subscription failure.
 *
 * @param {(url: string, options: object) => import('mqtt').MqttClient} connect
 * @param {{ url?: string, username?: string, password?: string, topic?: string }} payload
 * @param {(topic: string, message: string) => void} onMessage
 * @param {number} [durationMs]
 */
export function probeTopic(connect, payload, onMessage, durationMs = 5000) {
  return new Promise((resolve) => {
    const topic = typeof payload.topic === 'string' ? payload.topic.trim() : '';
    if (topic === '') {
      resolve({ ok: false, message: 'No topic configured' });
      return;
    }
    let client;
    let count = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        client?.end(true);
      } catch {
        // ignore teardown errors
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: true, count }), durationMs);
    try {
      client = connect(normalizeBrokerUrl(payload.url), connectionOptions(payload, durationMs));
    } catch (e) {
      finish({ ok: false, message: errorMessage(e) });
      return;
    }
    client.on('connect', () => {
      client.subscribe(topic, (err) => {
        if (err) {
          finish({ ok: false, message: errorMessage(err) });
        }
      });
    });
    client.on('message', (receivedTopic, message) => {
      count++;
      onMessage(receivedTopic, message.toString());
    });
    client.on('error', (err) => finish({ ok: false, message: errorMessage(err) }));
  });
}
