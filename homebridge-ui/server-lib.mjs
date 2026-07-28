// Pure handler logic for the custom UI server (homebridge-ui/server.js).
// Every I/O dependency (fs readdir/readFile/writeFile, mqtt connect) is
// injected so the functions can be unit-tested with fakes; server.js stays a
// thin shell.
import { createHash } from 'node:crypto';

/** Codec names bundled with the plugin (see codecs/). */
export const BUILT_IN_CODECS = ['json', 'shellyAMAX'];

/** Alias of the platform block this plugin owns. */
export const MQTTTHING_PLATFORM = 'mqttthing-ex';

/** Alias of the legacy accessory blocks this plugin owns. */
export const MQTTTHING_ACCESSORY = 'mqttthing';

/** Refuse blocks beyond this size - a sanity limit, not a real-world one. */
export const MAX_BLOCK_CHARS = 2_000_000;

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

// --- legacy accessory block access ----------------------------------------
//
// The platform block is managed by homebridge-config-ui-x itself
// (getPluginConfig/updatePluginConfig, driven by the schema's platform
// pluginType). Legacy "accessory": "mqttthing" entries are invisible to that
// API, so they are read and written here - carefully: this is the user's whole
// config.json.

/** Content hash of a block or block list, used to detect concurrent edits. */
export function hashOfBlock(block) {
  if (block === null || block === undefined) {
    return null;
  }
  return createHash('sha256').update(JSON.stringify(block)).digest('hex');
}

/** Every "mqttthing" entry of accessories[], with its position. */
export function findMqttthingAccessoryBlocks(config) {
  const accessories = config === null || typeof config !== 'object' ? undefined : config.accessories;
  if (!Array.isArray(accessories)) {
    return [];
  }
  const found = [];
  accessories.forEach((block, index) => {
    if (block && typeof block === 'object' && block.accessory === MQTTTHING_ACCESSORY) {
      found.push({ block, index });
    }
  });
  return found;
}

/**
 * The accessory alias is "mqttthing" and the platform alias is
 * "mqttthing-ex", which is easy to mix up. A platforms[] entry using the
 * accessory alias is reported rather than ignored: Homebridge cannot load it,
 * and silently showing "no platform block" would send the user round in
 * circles. Only entries that look like ours (a devices array) are claimed.
 */
function assertNoMistypedBlock(config) {
  const platforms = config === null || typeof config !== 'object' ? undefined : config.platforms;
  if (!Array.isArray(platforms)) {
    return;
  }
  const mistyped = platforms.some(
    (block) => block && typeof block === 'object' && block.platform === 'mqttthing' && Array.isArray(block.devices),
  );
  if (mistyped) {
    throw new Error(
      'config.json has a platform block with "platform": "mqttthing", which Homebridge cannot load. ' +
        `The platform alias is "${MQTTTHING_PLATFORM}" - "mqttthing" is the accessory alias. ` +
        'Rename it in the JSON config editor.',
    );
  }
}

async function parseConfigFile(readFile, configPath) {
  if (typeof configPath !== 'string' || configPath === '') {
    throw new Error(
      'The Homebridge UI did not provide the config.json path; ' +
        'editing legacy accessory blocks requires a newer homebridge-config-ui-x.',
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
 * Read the legacy accessory blocks. Resolves with { blocks, hash }; the hash
 * is passed back on save so a concurrent edit can be detected. An empty list
 * still hashes, so "someone deleted them all behind my back" is detectable.
 *
 * @param {(path: string, encoding: string) => Promise<string>} readFile
 * @param {string} configPath
 */
export async function readAccessoryConfig(readFile, configPath) {
  const { config } = await parseConfigFile(readFile, configPath);
  assertNoMistypedBlock(config);
  const blocks = findMqttthingAccessoryBlocks(config).map((entry) => entry.block);
  return { blocks, hash: hashOfBlock(blocks) };
}

/**
 * Structural validation of a block before it is written. Content beyond this
 * (topic names, option values) is the UI's advisory validation - the point
 * here is that nothing malformed can reach config.json.
 *
 * Returns the block to write; throws with a specific message otherwise.
 */
export function validateAccessoryBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    throw new Error('The accessory configuration must be a JSON array.');
  }
  const validated = blocks.map((block, index) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      throw new Error(`accessories[${index}] must be a JSON object.`);
    }
    if (typeof block.name !== 'string' || block.name.trim() === '') {
      throw new Error(`accessories[${index}] must have a non-empty "name".`);
    }
    if (typeof block.type !== 'string' || block.type.trim() === '') {
      throw new Error(`accessories[${index}] ("${block.name}") must have a non-empty "type".`);
    }
    // The alias is what makes Homebridge hand the block to this plugin, and
    // it is also half of the accessory's HomeKit identity, so it is forced
    // rather than trusted.
    return { ...block, accessory: MQTTTHING_ACCESSORY };
  });

  if (JSON.stringify(validated).length > MAX_BLOCK_CHARS) {
    throw new Error('The accessory configuration is too large to write.');
  }
  return validated;
}

/** config.json with this plugin's accessory blocks dropped, for comparison. */
function skeletonWithoutOurAccessories(config) {
  const accessories = Array.isArray(config.accessories)
    ? config.accessories.filter(
        (block) => !(block && typeof block === 'object' && block.accessory === MQTTTHING_ACCESSORY),
      )
    : config.accessories;
  return JSON.stringify({ ...config, accessories });
}

/**
 * Replace this plugin's accessory blocks in config.json, leaving everything
 * else byte-identical in content. The write is guarded: an unreadable or
 * unparseable file, a concurrent change or a malformed block all abort before
 * anything is written, a backup is taken, and the file is replaced atomically.
 *
 * Surviving blocks keep their original positions in accessories[]; added ones
 * follow the last of them, so a save does not reshuffle the user's file.
 *
 * @param {{ readFile: Function, writeFile: Function, rename: Function,
 *           copyFile: Function, stat: Function, chmod: Function,
 *           unlink: Function }} fsDeps
 * @param {string} configPath
 * @param {object[]} blocks
 * @param {string|null} baseHash Hash from the read that this edit started from.
 */
export async function writeAccessoryConfig(fsDeps, configPath, blocks, baseHash) {
  const { readFile, writeFile, rename, copyFile, stat, chmod, unlink } = fsDeps;
  const { config } = await parseConfigFile(readFile, configPath);
  assertNoMistypedBlock(config);

  const current = findMqttthingAccessoryBlocks(config);
  const currentHash = hashOfBlock(current.map((entry) => entry.block));
  if ((baseHash ?? null) !== currentHash) {
    throw new Error(
      'The accessory configuration in config.json changed outside this editor ' +
        '(for example in the JSON config editor). Close and reopen this settings window, ' +
        'then re-apply your changes.',
    );
  }

  const validated = validateAccessoryBlocks(blocks);

  if (config.accessories === undefined) {
    config.accessories = [];
  } else if (!Array.isArray(config.accessories)) {
    throw new Error('config.json has an "accessories" property that is not an array. Refusing to touch it.');
  }

  // Everything outside this plugin's accessory blocks must be exactly as it
  // was read. Dropping our blocks from both sides makes that an equality
  // check rather than a size heuristic, so deleting every one of them is fine
  // while losing an unrelated entry never is.
  const skeletonBefore = skeletonWithoutOurAccessories(config);

  const next = [...config.accessories];
  const kept = Math.min(current.length, validated.length);
  for (let i = 0; i < kept; i++) {
    next[current[i].index] = validated[i];
  }
  if (validated.length > current.length) {
    const insertAt = current.length > 0 ? current[current.length - 1].index + 1 : next.length;
    next.splice(insertAt, 0, ...validated.slice(kept));
  } else {
    // highest index first, so the earlier positions stay valid
    for (let i = current.length - 1; i >= kept; i--) {
      next.splice(current[i].index, 1);
    }
  }
  config.accessories = next;

  const skeletonAfter = skeletonWithoutOurAccessories(config);
  if (skeletonBefore !== skeletonAfter) {
    throw new Error(
      "Refusing to write config.json: the change would affect more than this plugin's accessory blocks.",
    );
  }

  const serialized = JSON.stringify(config, null, 4) + '\n';

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
