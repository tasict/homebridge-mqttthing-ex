import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThingConfig } from '../config.js';
import type { Log } from '../log.js';

/** info object passed to codec encode/decode functions. */
export interface CodecFunctionInfo {
  topic: string;
  property: string;
  extendedTopic: unknown | null;
}

/**
 * Codec encode/decode signature. May return the transformed value, call
 * `output()` asynchronously (even multiple times), or do neither to suppress
 * the message.
 */
export type CodecFunction = (
  message: unknown,
  info: CodecFunctionInfo,
  output: (message: unknown) => void,
) => unknown;

export interface Codec {
  encode?: CodecFunction | null;
  decode?: CodecFunction | null;
  properties?: Record<string, { encode?: CodecFunction; decode?: CodecFunction }>;
  [key: string]: unknown;
}

export interface CodecInitParams {
  log: Log;
  config: ThingConfig;
  publish: (topic: string, message: unknown) => void;
  notify: (property: string, message: unknown) => void;
}

interface CodecModule {
  init?: (params: CodecInitParams) => Codec | undefined;
}

// CJS require with Node's shared module cache: a codec file used by several
// accessories is evaluated once, while init() runs once per accessory —
// exactly the upstream contract (docs/Codecs.md).
const require = createRequire(import.meta.url);

/**
 * Codec path resolution, ported from upstream mqttlib.js:13-26:
 * - path starting with '/' (or any absolute path): used as-is
 * - no '.js' suffix: built-in codec in the package's codecs/ directory
 * - otherwise: relative to the Homebridge user storage path
 */
export function makeCodecPath(codec: string, homebridgePath: string): string {
  let codecPath = codec;
  if (codecPath[0] !== '/' && !path.isAbsolute(codecPath)) {
    if (codecPath.substring(codecPath.length - 3) !== '.js') {
      // no js extension - assume it's an internal codec
      const codecsDir = fileURLToPath(new URL('../../codecs/', import.meta.url));
      codecPath = path.join(codecsDir, codecPath + '.js');
    } else {
      // relative external codec is relative to homebridge userdata
      codecPath = path.join(homebridgePath, codecPath);
    }
  }
  return codecPath;
}

/**
 * Load and initialise a codec (upstream mqttlib.js:63-106). Returns the codec
 * object, or null when the file is missing / exports no init function —
 * logging the same errors as upstream in those cases.
 */
export function loadCodec(
  codecName: string,
  homebridgePath: string,
  params: CodecInitParams,
): Codec | null {
  const { log } = params;
  const codecPath = makeCodecPath(codecName, homebridgePath);
  if (!fs.existsSync(codecPath)) {
    log.error('ERROR: Codec file [' + codecPath + '] does not exist');
    return null;
  }
  log('Loading codec from ' + codecPath);
  const codecMod = require(codecPath) as CodecModule;
  if (typeof codecMod.init !== 'function') {
    log.error('ERROR: No codec initialisation function returned from ' + codecPath);
    return null;
  }
  const codec = codecMod.init(params);
  if (codec) {
    // encode/decode must be functions
    if (typeof codec.encode !== 'function') {
      log.warn('No codec encode() function');
      codec.encode = null;
    }
    if (typeof codec.decode !== 'function') {
      log.warn('No codec decode() function');
      codec.decode = null;
    }
  }
  return codec ?? null;
}

/**
 * Resolve the codec function for a property: per-property override first,
 * falling back to the codec-wide default (upstream mqttlib.js:207-218).
 */
export function getCodecFunction(
  codec: Codec | null | undefined,
  property: string,
  functionName: 'encode' | 'decode',
): CodecFunction | null | undefined {
  if (codec) {
    let fn: CodecFunction | null | undefined;
    if (codec.properties && codec.properties[property]) {
      fn = codec.properties[property][functionName];
    }
    if (fn === undefined) {
      fn = codec[functionName];
    }
    return fn;
  }
}
