// Pure handler logic for the custom UI server (homebridge-ui/server.js).
// Every I/O dependency (fs readdir/readFile/writeFile, mqtt connect) is
// injected so the functions can be unit-tested with fakes; server.js stays a
// thin shell.
import { createHash } from 'node:crypto';

/** Codec names bundled with the plugin (see codecs/). */
export const BUILT_IN_CODECS = ['json', 'shellyAMAX'];

/** Alias of the platform block this plugin owns. */
export const MQTTTHING_PLATFORM = 'mqttthing';

/** Refuse blocks beyond this size - a sanity limit, not a real-world one. */
export const MAX_BLOCK_CHARS = 2_000_000;

/** Stand-in for the platform block while checking the rest of the file. */
const PLACEHOLDER = { __mqttthing__: 'placeholder' };

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

// --- platform block access ------------------------------------------------
//
// Legacy accessory blocks are managed by homebridge-config-ui-x itself
// (getPluginConfig/updatePluginConfig, driven by the schema's accessory
// pluginType). The platform block is invisible to that API, so it is read and
// written here - carefully: this is the user's whole config.json.

/** Content hash of a platform block, used to detect concurrent edits. */
export function hashOfBlock(block) {
  if (block === null || block === undefined) {
    return null;
  }
  return createHash('sha256').update(JSON.stringify(block)).digest('hex');
}

/** Every "mqttthing" entry of platforms[], with its position. */
export function findMqttthingPlatformBlocks(config) {
  const platforms = config === null || typeof config !== 'object' ? undefined : config.platforms;
  if (!Array.isArray(platforms)) {
    return [];
  }
  const found = [];
  platforms.forEach((block, index) => {
    if (block && typeof block === 'object' && block.platform === MQTTTHING_PLATFORM) {
      found.push({ block, index });
    }
  });
  return found;
}

function tooManyBlocks(count) {
  return new Error(
    `config.json contains ${count} "${MQTTTHING_PLATFORM}" platform blocks. ` +
      'Merge them into one in the JSON config editor before using platform mode.',
  );
}

async function parseConfigFile(readFile, configPath) {
  if (typeof configPath !== 'string' || configPath === '') {
    throw new Error(
      'The Homebridge UI did not provide the config.json path; ' +
        'platform mode requires a newer homebridge-config-ui-x.',
    );
  }
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (e) {
    throw new Error(`config.json could not be read: ${errorMessage(e)}. Refusing to touch it.`);
  }
  try {
    return { config: JSON.parse(raw), raw };
  } catch (e) {
    throw new Error(`config.json could not be parsed: ${errorMessage(e)}. Refusing to touch it.`);
  }
}

/**
 * Read the platform block. Resolves with { exists, block, hash }; the hash is
 * passed back on save so a concurrent edit can be detected.
 *
 * @param {(path: string, encoding: string) => Promise<string>} readFile
 * @param {string} configPath
 */
export async function readPlatformConfig(readFile, configPath) {
  const { config } = await parseConfigFile(readFile, configPath);
  const blocks = findMqttthingPlatformBlocks(config);
  if (blocks.length > 1) {
    throw new Error(tooManyBlocks(blocks.length).message);
  }
  if (blocks.length === 0) {
    return { exists: false, block: null, hash: null };
  }
  return { exists: true, block: blocks[0].block, hash: hashOfBlock(blocks[0].block) };
}

/**
 * Structural validation of a block before it is written. Content beyond this
 * (topic names, option values) is the UI's advisory validation - the point
 * here is that nothing malformed can reach config.json.
 *
 * Returns the block to write; throws with a specific message otherwise.
 */
export function validatePlatformBlock(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('The platform configuration must be a JSON object.');
  }
  const validated = { ...block, platform: MQTTTHING_PLATFORM };

  for (const key of ['name', 'url', 'username', 'password']) {
    if (validated[key] !== undefined && typeof validated[key] !== 'string') {
      throw new Error(`"${key}" must be a string.`);
    }
  }
  if (
    validated.mqttOptions !== undefined &&
    (typeof validated.mqttOptions !== 'object' || validated.mqttOptions === null || Array.isArray(validated.mqttOptions))
  ) {
    throw new Error('"mqttOptions" must be a JSON object.');
  }

  if (validated.devices !== undefined) {
    if (!Array.isArray(validated.devices)) {
      throw new Error('"devices" must be an array.');
    }
    const ids = new Set();
    validated.devices.forEach((device, index) => {
      if (!device || typeof device !== 'object' || Array.isArray(device)) {
        throw new Error(`devices[${index}] must be a JSON object.`);
      }
      if (typeof device.name !== 'string' || device.name.trim() === '') {
        throw new Error(`devices[${index}] must have a non-empty "name".`);
      }
      if (Object.prototype.hasOwnProperty.call(device, 'accessory')) {
        throw new Error(`devices[${index}] ("${device.name}") must not have an "accessory" property.`);
      }
      if (device.id !== undefined) {
        if (typeof device.id !== 'string' || device.id === '') {
          throw new Error(`devices[${index}] ("${device.name}") has an invalid "id".`);
        }
        if (ids.has(device.id)) {
          throw new Error(`devices[${index}] ("${device.name}") reuses the id "${device.id}".`);
        }
        ids.add(device.id);
      }
    });
  }

  if (JSON.stringify(validated).length > MAX_BLOCK_CHARS) {
    throw new Error('The platform configuration is too large to write.');
  }
  return validated;
}

/**
 * Replace (or add) the platform block in config.json, leaving everything else
 * byte-identical in content. The write is guarded: an unreadable or
 * unparseable file, a concurrent change, a malformed block or an unexpectedly
 * large shrink all abort before anything is written, a backup is taken, and
 * the file is replaced atomically.
 *
 * @param {{ readFile: Function, writeFile: Function, rename: Function,
 *           copyFile: Function, stat: Function, chmod: Function,
 *           unlink: Function }} fsDeps
 * @param {string} configPath
 * @param {object} block
 * @param {string|null} baseHash Hash from the read that this edit started from.
 */
export async function writePlatformConfig(fsDeps, configPath, block, baseHash) {
  const { readFile, writeFile, rename, copyFile, stat, chmod, unlink } = fsDeps;
  const { config } = await parseConfigFile(readFile, configPath);

  const blocks = findMqttthingPlatformBlocks(config);
  if (blocks.length > 1) {
    throw tooManyBlocks(blocks.length);
  }
  const current = blocks[0];
  const currentHash = current ? hashOfBlock(current.block) : null;
  if ((baseHash ?? null) !== currentHash) {
    throw new Error(
      'The platform configuration in config.json changed outside this editor ' +
        '(for example in the JSON config editor). Close and reopen this settings window, ' +
        'then re-apply your changes.',
    );
  }

  const validated = validatePlatformBlock(block);

  if (config.platforms === undefined) {
    config.platforms = [];
  } else if (!Array.isArray(config.platforms)) {
    throw new Error('config.json has a "platforms" property that is not an array. Refusing to touch it.');
  }

  const index = current ? current.index : config.platforms.length;
  config.platforms[index] = PLACEHOLDER;
  const skeletonBefore = JSON.stringify(config);

  config.platforms[index] = validated;
  const serialized = JSON.stringify(config, null, 4) + '\n';

  // Everything outside the platform block must be exactly as it was read.
  // Blanking the block out on both sides makes that an equality check rather
  // than a size heuristic, so emptying a large block is fine while losing an
  // unrelated key never is.
  config.platforms[index] = PLACEHOLDER;
  const skeletonAfter = JSON.stringify(config);
  config.platforms[index] = validated;

  if (skeletonBefore !== skeletonAfter) {
    throw new Error('Refusing to write config.json: the change would affect more than the platform block.');
  }

  await copyFile(configPath, `${configPath}.bak-mqttthing`);

  const tmpPath = `${configPath}.tmp-mqttthing`;
  try {
    await writeFile(tmpPath, serialized, 'utf8');
    try {
      const info = await stat(configPath);
      await chmod(tmpPath, info.mode);
    } catch {
      // keep the default mode if the original cannot be inspected
    }
    await rename(tmpPath, configPath);
  } catch (e) {
    try {
      await unlink(tmpPath);
    } catch {
      // nothing to clean up
    }
    throw e;
  }

  return { hash: hashOfBlock(validated) };
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
