// Configuration validation against the declarative accessory-type model.
//
// Implements the F13 checks from docs/UpstreamIssues.md (upstream #403, #677,
// #366) as a pure function. It is NOT wired into the accessory runtime yet,
// so runtime behavior is unchanged; the custom config UI and a future
// startup validation pass will consume it.
import type { ThingConfig } from '../config.js';
import { GLOBAL_OPTIONS, GLOBAL_TOPICS, type AccessoryTypeModel } from './model-types.js';
import { getTypeModel } from './types.js';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Top-level keys that are structural rather than options: never warned about.
 * '_bridge' is homebridge's child-bridge configuration key; 'subtype' is set
 * internally when expanding custom accessories.
 */
const CORE_KEYS = new Set(['accessory', 'type', 'name', 'topics', 'services', 'subtype', '_bridge']);

/** Levenshtein edit distance (small inputs only). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev: number[] = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur: number[] = [i];
    for (let j = 1; j < cols; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + substitutionCost);
    }
    prev = cur;
  }
  return prev[cols - 1];
}

/**
 * Near-miss suggestion for an unknown key:
 *  1. case-insensitive and/or surrounding-whitespace match (covers upstream
 *     #677 'valvetype' and #366 trailing-space topic keys), then
 *  2. Levenshtein distance <= 2 on the normalized strings (small typos).
 * Returns the correctly-spelled known key, or undefined when nothing is close.
 */
export function suggestNearMiss(key: string, knownKeys: Iterable<string>): string | undefined {
  const normalized = key.trim().toLowerCase();
  let best: string | undefined;
  let bestDistance = 3; // accept distance <= 2 only
  for (const known of knownKeys) {
    if (known === key) {
      continue;
    }
    if (known.toLowerCase() === normalized) {
      return known;
    }
    const distance = editDistance(normalized, known.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

function withSuggestion(message: string, suggestion: string | undefined): string {
  return suggestion ? `${message} - did you mean '${suggestion}'?` : message;
}

function validateOneService(
  config: ThingConfig,
  model: AccessoryTypeModel,
  result: ValidationResult,
  messagePrefix: string,
  skipOptionChecks: boolean,
): void {
  const topicKeyList: string[] = [];
  for (const t of [...model.topics, ...GLOBAL_TOPICS]) {
    if (!topicKeyList.includes(t.key)) {
      topicKeyList.push(t.key);
    }
  }

  // 1. topics object missing entirely (upstream #403: crash; here: error)
  const topics = config.topics;
  const hasTopics = typeof topics === 'object' && topics !== null;
  if (!hasTopics) {
    if (!model.topicsOptional) {
      result.errors.push(
        `${messagePrefix}no 'topics' configured - accessory type '${model.id}' requires a topics object`,
      );
    }
  } else {
    // 2. required topics
    for (const t of model.topics) {
      if (t.required && !(t.key in topics)) {
        result.errors.push(
          `${messagePrefix}required topic '${t.key}' (${t.label}) is not configured for type '${model.id}'`,
        );
      }
    }

    // 3. unknown topic keys with near-miss suggestions (upstream #677, #366)
    for (const key of Object.keys(topics)) {
      if (!topicKeyList.includes(key)) {
        const suggestion = suggestNearMiss(key, topicKeyList);
        result.warnings.push(
          withSuggestion(`${messagePrefix}unknown topic '${key}' for type '${model.id}'`, suggestion),
        );
      }
    }
  }

  // 4. unknown top-level option keys. Skipped entirely when a codec is
  // configured: codecs read arbitrary config keys, so extra keys are normal.
  if (!skipOptionChecks) {
    const optionKeyList: string[] = [];
    for (const o of [...model.options, ...GLOBAL_OPTIONS]) {
      if (!optionKeyList.includes(o.key)) {
        optionKeyList.push(o.key);
      }
    }
    for (const key of Object.keys(config)) {
      if (CORE_KEYS.has(key)) {
        continue;
      }
      if (!optionKeyList.includes(key)) {
        const suggestion = suggestNearMiss(key, optionKeyList);
        result.warnings.push(
          withSuggestion(`${messagePrefix}unknown option '${key}' for type '${model.id}'`, suggestion),
        );
      }
    }
  }
}

/**
 * Validate a single accessory (or sub-service) configuration against the
 * declarative model. Pure function - it never mutates the config and never
 * changes runtime behavior.
 *
 * @param config the accessory configuration ('mqttthing' accessory entry)
 * @param model  optional explicit type model; resolved from config.type
 *               (including 'type-subtype' forms) when omitted
 */
export function validateThingConfig(
  config: ThingConfig,
  model?: AccessoryTypeModel,
): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };

  const resolved = model ?? getTypeModel(config.type);
  if (!resolved) {
    result.errors.push(`unrecognized accessory type '${config.type}'`);
    return result;
  }

  // Codecs read arbitrary config keys, so with a codec configured unknown
  // option keys must never be warned about (topic-key checks still apply).
  const hasCodec = typeof config.codec === 'string' && config.codec.length > 0;

  if (resolved.id === 'custom') {
    // The custom accessory groups sub-services; option keys at the custom
    // level act as defaults for every service, so they cannot be checked
    // against a single type model. Validate each sub-service instead.
    const services = config.services;
    if (!Array.isArray(services) || services.length === 0) {
      result.errors.push("custom accessory has no 'services' array");
      return result;
    }
    services.forEach((serviceConfig, index) => {
      const label = serviceConfig?.name || `#${index + 1}`;
      const serviceModel = getTypeModel(serviceConfig?.type);
      if (!serviceModel) {
        result.errors.push(`service '${label}': unrecognized accessory type '${serviceConfig?.type}'`);
        return;
      }
      if (serviceModel.id === 'custom') {
        result.errors.push(`service '${label}': custom accessories cannot be nested`);
        return;
      }
      // Sub-services inherit defaults from the parent, so only per-service
      // keys are checked; option checks are skipped (inheritance makes any
      // parent-level option key legitimate on the merged config).
      validateOneService(serviceConfig, serviceModel, result, `service '${label}': `, true);
    });
    return result;
  }

  validateOneService(config, resolved, result, '', hasCodec);
  return result;
}
