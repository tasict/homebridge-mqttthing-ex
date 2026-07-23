// View A - the accessory list: search, type filter, sort, add, and per-row
// actions (edit, duplicate, delete, reorder). Reordering is only available
// while the list shows the raw config order without filters.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import { deepClone, duplicateName, matchesSearch } from '../lib/config-ops.js';
import { summarizeConfig } from '../lib/validation.js';
import { hb } from '../homebridge.js';

type SortMode = 'config' | 'name' | 'type';

interface Props {
  configs: ThingConfig[];
  touch: () => void;
  onEdit: (index: number) => void;
  onAdd: () => void;
}

function typeLabel(type: string | undefined): string {
  const model = getTypeModel(type);
  if (!model) {
    return type ? `${type} (unknown)` : '(no type)';
  }
  return model.id === type ? model.label : `${model.label} (${type})`;
}

export function ListView({ configs, touch, onEdit, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('config');
  const [showJson, setShowJson] = useState(false);

  // The working copy is mutated in place (stable identity), so this is
  // recomputed on every render instead of memoized.
  const presentTypes: string[] = [];
  for (const config of configs) {
    const base = getTypeModel(config.type)?.id ?? String(config.type ?? '');
    if (base && !presentTypes.includes(base)) {
      presentTypes.push(base);
    }
  }
  presentTypes.sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

  let entries = configs
    .map((config, index) => ({ config, index }))
    .filter((e) => matchesSearch(e.config, query))
    .filter((e) => typeFilter === '' || (getTypeModel(e.config.type)?.id ?? String(e.config.type ?? '')) === typeFilter);
  if (sortMode === 'name') {
    entries = [...entries].sort((a, b) => String(a.config.name ?? '').localeCompare(String(b.config.name ?? '')));
  } else if (sortMode === 'type') {
    entries = [...entries].sort((a, b) => typeLabel(a.config.type).localeCompare(typeLabel(b.config.type)));
  }

  const canReorder = sortMode === 'config' && query.trim() === '' && typeFilter === '';

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= configs.length) {
      return;
    }
    const [entry] = configs.splice(index, 1);
    configs.splice(target, 0, entry);
    touch();
  };

  const duplicate = (index: number) => {
    const original = configs[index];
    const copy = deepClone(original);
    copy.name = duplicateName(configs.map((c) => String(c.name ?? '')), String(original.name ?? 'accessory'));
    configs.splice(index + 1, 0, copy);
    touch();
    onEdit(index + 1);
  };

  const remove = (index: number) => {
    const name = String(configs[index].name ?? `#${index + 1}`);
    if (window.confirm(`Delete accessory "${name}"? This cannot be undone after saving.`)) {
      configs.splice(index, 1);
      touch();
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(configs, null, 2));
      hb().toast.success('Configuration copied to the clipboard');
    } catch {
      hb().toast.error('Could not access the clipboard');
    }
  };

  return (
    <div>
      <div class="d-flex flex-wrap gap-2 mb-3">
        <input
          type="search"
          class="form-control form-control-sm w-auto flex-grow-1"
          placeholder="Search name, type or topic&hellip;"
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <select
          class="form-select form-select-sm w-auto"
          value={typeFilter}
          onChange={(e) => setTypeFilter((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">All types</option>
          {presentTypes.map((id) => (
            <option key={id} value={id}>
              {typeLabel(id)}
            </option>
          ))}
        </select>
        <select
          class="form-select form-select-sm w-auto"
          value={sortMode}
          onChange={(e) => setSortMode((e.currentTarget as HTMLSelectElement).value as SortMode)}
        >
          <option value="config">Config order</option>
          <option value="name">Sort by name</option>
          <option value="type">Sort by type</option>
        </select>
        <button class="btn btn-primary btn-sm" onClick={onAdd}>
          + Add accessory
        </button>
      </div>

      {configs.length === 0 && (
        <div class="alert alert-info">
          No mqttthing accessories configured yet. Use <strong>Add accessory</strong> to create the first one.
        </div>
      )}
      {configs.length > 0 && entries.length === 0 && <div class="alert alert-secondary">No accessories match the current search.</div>}

      {entries.length > 0 && (
        <table class="table table-sm mqx-topic-table align-middle">
          <tbody>
            {entries.map(({ config, index }) => {
              const summary = summarizeConfig(config);
              const findings = [...summary.errors, ...summary.warnings];
              const serviceCount = Array.isArray(config.services) ? config.services.length : 0;
              return (
                <tr key={index} class="mqx-list-row" onClick={() => onEdit(index)}>
                  <td>
                    <strong>{String(config.name ?? '(unnamed)')}</strong>
                    <div class="mqx-key">{typeLabel(config.type)}</div>
                  </td>
                  <td class="text-end" style="width: 1%; white-space: nowrap;">
                    {serviceCount > 0 && (
                      <span class="badge text-bg-secondary me-1" title="Grouped services">
                        {serviceCount} services
                      </span>
                    )}
                    {summary.total > 0 && (
                      <span
                        class={`badge me-1 ${summary.errors.length > 0 ? 'text-bg-danger' : 'text-bg-warning'}`}
                        title={findings.join('\n')}
                      >
                        {summary.total} {summary.total === 1 ? 'issue' : 'issues'}
                      </span>
                    )}
                  </td>
                  <td class="text-end mqx-row-actions" style="width: 1%; white-space: nowrap;" onClick={(e) => e.stopPropagation()}>
                    <div class="btn-group">
                      <button class="btn btn-outline-secondary" title="Move up" disabled={!canReorder || index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </button>
                      <button
                        class="btn btn-outline-secondary"
                        title="Move down"
                        disabled={!canReorder || index === configs.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                      <button class="btn btn-outline-secondary" title="Duplicate" onClick={() => duplicate(index)}>
                        ⧉
                      </button>
                      <button class="btn btn-outline-danger" title="Delete" onClick={() => remove(index)}>
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div class="d-flex align-items-center gap-2 mt-2">
        <span class="text-body-secondary small">
          {entries.length === configs.length
            ? `${configs.length} ${configs.length === 1 ? 'accessory' : 'accessories'}`
            : `${entries.length} of ${configs.length} accessories`}
        </span>
        <button class="btn btn-link btn-sm ms-auto p-0" onClick={() => setShowJson(!showJson)}>
          {showJson ? 'Hide JSON' : 'View JSON'}
        </button>
      </div>
      {showJson && (
        <div class="mt-2">
          <textarea class="form-control mqx-json-view" rows={16} readOnly value={JSON.stringify(configs, null, 2)} />
          <button class="btn btn-outline-secondary btn-sm mt-1" onClick={copyJson}>
            Copy to clipboard
          </button>
        </div>
      )}
    </div>
  );
}
