// Pure working-copy operations for the custom config UI.
//
// The editor's highest correctness requirement is a NON-DESTRUCTIVE
// round-trip: every key the UI does not model must survive editing
// untouched. All helpers here therefore mutate the actual configuration
// objects in place, changing only the edited key, and never rebuild
// objects from form state.
import type { ExtendedTopic, ThingConfig, TopicSpec } from '../../../src/config.js';
import { GLOBAL_TOPICS } from '../../../src/model/model-types.js';
import { getTypeModel } from '../../../src/model/types.js';

/** Deep-clone a configuration value (plain JSON data only). */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Generate a name for a duplicated accessory: "<base> copy", then
 * "<base> copy 2", "<base> copy 3", ... until the name is unused.
 */
export function duplicateName(existingNames: string[], baseName: string): string {
  const used = new Set(existingNames);
  let candidate = `${baseName} copy`;
  for (let n = 2; used.has(candidate); n++) {
    candidate = `${baseName} copy ${n}`;
  }
  return candidate;
}

/**
 * Insert a deep copy of the accessory at `index` directly after it, with a
 * collision-free "<name> copy" name. Returns the index of the new copy.
 */
export function duplicateAccessory(configs: ThingConfig[], index: number): number {
  const original = configs[index];
  const copy = deepClone(original);
  copy.name = duplicateName(configs.map((c) => String(c.name ?? '')), String(original.name ?? 'accessory'));
  configs.splice(index + 1, 0, copy);
  return index + 1;
}

/** Remove the accessory at `index` from the working copy in place. */
export function deleteAccessory(configs: ThingConfig[], index: number): void {
  configs.splice(index, 1);
}

/** True where a topic spec is the extended { topic, apply } object form. */
export function isExtendedTopic(spec: TopicSpec | undefined): spec is ExtendedTopic {
  return typeof spec === 'object' && spec !== null;
}

/** The MQTT topic string of a topic spec ('' when unset). */
export function topicString(spec: TopicSpec | undefined): string {
  if (spec === undefined) {
    return '';
  }
  if (isExtendedTopic(spec)) {
    return typeof spec.topic === 'string' ? spec.topic : '';
  }
  return spec;
}

/** The apply function body of a topic spec (undefined when none). */
export function topicApply(spec: TopicSpec | undefined): string | undefined {
  if (isExtendedTopic(spec) && typeof spec.apply === 'string') {
    return spec.apply;
  }
  return undefined;
}

/**
 * MQTT topic to subscribe to for a get-topic spec: the part before any
 * JSONPath suffix ('$'), trimmed - matching the runtime subscription rule.
 */
export function probeTopicFor(spec: TopicSpec | undefined): string {
  const raw = topicString(spec);
  const dollar = raw.indexOf('$');
  return (dollar >= 0 ? raw.substring(0, dollar) : raw).trim();
}

/** The topics object of a config, created (and attached) when missing. */
export function ensureTopics(config: ThingConfig): Record<string, TopicSpec> {
  if (typeof config.topics !== 'object' || config.topics === null) {
    config.topics = {};
  }
  return config.topics;
}

/**
 * Set (or clear) the MQTT topic string of one topic key, preserving the
 * extended object form and any keys inside it:
 * - plain string values are replaced; cleared values delete the key;
 * - object values keep their identity: only .topic is assigned. The key is
 *   deleted on clear only when the object carries nothing but a topic.
 */
export function setTopic(config: ThingConfig, key: string, value: string): void {
  const next = value.trim();
  const topics = config.topics;
  const existing = topics?.[key];

  if (existing === undefined) {
    if (next !== '') {
      ensureTopics(config)[key] = next;
    }
    return;
  }
  if (isExtendedTopic(existing)) {
    const extraKeys = Object.keys(existing).filter((k) => k !== 'topic');
    if (next === '' && extraKeys.length === 0) {
      delete topics![key];
    } else {
      existing.topic = next;
    }
    return;
  }
  if (next === '') {
    delete topics![key];
  } else {
    topics![key] = next;
  }
}

/**
 * Set (or clear) the apply function body of one topic key:
 * - setting on a plain string upgrades it to { topic, apply };
 * - clearing deletes .apply and collapses { topic } back to a plain string
 *   only when no other (unmodeled) keys remain in the object.
 */
export function setTopicApply(config: ThingConfig, key: string, body: string): void {
  const next = body.trim();
  const topics = config.topics;
  const existing = topics?.[key];

  if (next === '') {
    if (isExtendedTopic(existing)) {
      delete existing.apply;
      const remaining = Object.keys(existing);
      if (remaining.length === 1 && remaining[0] === 'topic' && typeof existing.topic === 'string') {
        topics![key] = existing.topic;
      }
    }
    return;
  }
  if (existing === undefined) {
    ensureTopics(config)[key] = { topic: '', apply: next };
  } else if (isExtendedTopic(existing)) {
    existing.apply = next;
  } else {
    ensureTopics(config)[key] = { topic: existing, apply: next };
  }
}

/**
 * Set (or clear) a top-level option key in place. undefined, null and ''
 * delete the key; everything else is assigned as-is.
 */
export function setOption(config: ThingConfig, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    delete config[key];
  } else {
    config[key] = value;
  }
}

function topicStringsOf(config: ThingConfig): string[] {
  const out: string[] = [];
  const collect = (topics: ThingConfig['topics']) => {
    if (typeof topics !== 'object' || topics === null) {
      return;
    }
    for (const spec of Object.values(topics)) {
      if (Array.isArray(spec)) {
        for (const item of spec) {
          out.push(topicString(item as TopicSpec));
        }
      } else {
        out.push(topicString(spec));
      }
    }
  };
  collect(config.topics);
  if (Array.isArray(config.services)) {
    for (const service of config.services) {
      collect(service?.topics);
    }
  }
  return out;
}

/**
 * Search matcher for the accessory list: case-insensitive substring match
 * against the name, the type and every configured MQTT topic string
 * (including sub-service topics of custom accessories).
 */
export function matchesSearch(config: ThingConfig, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return true;
  }
  if (String(config.name ?? '').toLowerCase().includes(q)) {
    return true;
  }
  if (String(config.type ?? '').toLowerCase().includes(q)) {
    return true;
  }
  return topicStringsOf(config).some((t) => t.toLowerCase().includes(q));
}

/**
 * Change the accessory type in place, preserving every configured topic
 * that also exists in the new type's model (or is a global topic). Topics
 * the new type does not know are removed; their keys are returned so the
 * UI can report what was dropped. Switching to 'custom' keeps everything
 * (the user restructures into services manually).
 */
export function changeAccessoryType(config: ThingConfig, newType: string): string[] {
  config.type = newType;
  const model = getTypeModel(newType);
  const topics = config.topics;
  if (!model || model.id === 'custom' || typeof topics !== 'object' || topics === null) {
    return [];
  }
  const known = new Set<string>([
    ...model.topics.map((t) => t.key),
    ...GLOBAL_TOPICS.map((t) => t.key),
  ]);
  const dropped: string[] = [];
  for (const key of Object.keys(topics)) {
    if (!known.has(key)) {
      dropped.push(key);
      delete topics[key];
    }
  }
  return dropped;
}

export interface BrokerSettings {
  url?: string;
  username?: string;
  password?: string;
}

/**
 * The most common broker settings (url/username/password triple) among the
 * existing accessories - used to prefill the add wizard. Entries without a
 * url are ignored; undefined when nothing usable exists.
 */
export function mostCommonBroker(configs: ThingConfig[]): BrokerSettings | undefined {
  const counts = new Map<string, { count: number; broker: BrokerSettings }>();
  for (const config of configs) {
    if (typeof config.url !== 'string' || config.url === '') {
      continue;
    }
    const broker: BrokerSettings = { url: config.url };
    if (typeof config.username === 'string' && config.username !== '') {
      broker.username = config.username;
    }
    if (typeof config.password === 'string' && config.password !== '') {
      broker.password = config.password;
    }
    const id = JSON.stringify([broker.url, broker.username ?? '', broker.password ?? '']);
    const entry = counts.get(id);
    if (entry) {
      entry.count++;
    } else {
      counts.set(id, { count: 1, broker });
    }
  }
  let best: { count: number; broker: BrokerSettings } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  return best?.broker;
}

/**
 * Replace the contents of a config object in place with the given
 * replacement keys, keeping the object identity (used by the per-accessory
 * "Edit as JSON" escape hatch so the working-copy array stays untouched).
 */
export function replaceConfigContents(config: ThingConfig, replacement: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    delete config[key];
  }
  Object.assign(config, replacement);
}
