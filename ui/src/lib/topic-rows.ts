// Topic-table row model: pairs the flat get/set topic keys of an accessory
// type model into one row per characteristic, required rows first.
import type { TopicModel } from '../../../src/model/model-types.js';
import { GLOBAL_TOPICS } from '../../../src/model/model-types.js';
import { getTypeModel } from '../../../src/model/types.js';

export interface TopicRow {
  /** Row id: the topic key without its get/set prefix (e.g. 'On'). */
  id: string;
  label: string;
  required: boolean;
  description?: string;
  get?: TopicModel;
  set?: TopicModel;
}

function baseOf(key: string): string {
  if (key.startsWith('get')) {
    return key.substring(3);
  }
  if (key.startsWith('set')) {
    return key.substring(3);
  }
  return key;
}

function buildRows(topics: TopicModel[]): TopicRow[] {
  const rows: TopicRow[] = [];
  const byBase = new Map<string, TopicRow>();
  for (const topic of topics) {
    const base = baseOf(topic.key);
    let row = byBase.get(base);
    if (!row) {
      row = { id: base, label: topic.label, required: false, description: topic.description };
      byBase.set(base, row);
      rows.push(row);
    }
    if (topic.direction === 'get' && !row.get) {
      row.get = topic;
      // prefer the get-topic label/description for the row
      row.label = topic.label;
      row.description = topic.description ?? row.description;
    } else if (topic.direction === 'set' && !row.set) {
      row.set = topic;
    }
    row.required = row.required || topic.required === true;
  }
  // required rows first, keeping the model order within each group
  return [...rows.filter((r) => r.required), ...rows.filter((r) => !r.required)];
}

/**
 * Rows for the topic table of an accessory type: type-specific rows
 * (required first) and the global rows every type accepts. Unknown types
 * yield empty row lists.
 */
export function buildTopicRows(typeId: string | undefined): { rows: TopicRow[]; globals: TopicRow[] } {
  const model = getTypeModel(typeId);
  if (!model) {
    return { rows: [], globals: buildRows(GLOBAL_TOPICS) };
  }
  const typeKeys = new Set(model.topics.map((t) => t.key));
  return {
    rows: buildRows(model.topics),
    globals: buildRows(GLOBAL_TOPICS.filter((t) => !typeKeys.has(t.key))),
  };
}
