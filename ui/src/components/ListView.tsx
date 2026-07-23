// View A - the accessory list: search, type filter, sort and add on top of
// a responsive card grid (one accessory per card, opened via a single Edit
// button). Duplicate and delete live in the editor; the raw config order is
// preserved as the default sort.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import { matchesSearch } from '../lib/config-ops.js';
import { summarizeConfig } from '../lib/validation.js';
import { hb } from '../homebridge.js';
import { TypeIcon } from './TypeIcon.js';

type SortMode = 'config' | 'name' | 'type';

interface Props {
  configs: ThingConfig[];
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

export function ListView({ configs, onEdit, onAdd }: Props) {
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
          class="form-control w-auto flex-grow-1"
          placeholder="Search name, type or topic&hellip;"
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <select
          class="form-select w-auto"
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
          class="form-select w-auto"
          value={sortMode}
          onChange={(e) => setSortMode((e.currentTarget as HTMLSelectElement).value as SortMode)}
        >
          <option value="config">Config order</option>
          <option value="name">Sort by name</option>
          <option value="type">Sort by type</option>
        </select>
        <button class="btn btn-primary" onClick={onAdd}>
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
        <div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">
          {entries.map(({ config, index }) => {
            const summary = summarizeConfig(config);
            const findings = [...summary.errors, ...summary.warnings];
            const serviceCount = Array.isArray(config.services) ? config.services.length : 0;
            return (
              <div key={index} class="col">
                {/* the whole card is a pointer shortcut; the Edit button is the accessible control */}
                <div class="card h-100 mqx-acc-card" onClick={() => onEdit(index)}>
                  <div class="card-body d-flex flex-column p-3">
                    <div class="d-flex align-items-center gap-3">
                      <div class="mqx-card-icon flex-shrink-0">
                        <TypeIcon type={config.type} size={26} />
                      </div>
                      <div class="flex-grow-1 overflow-hidden">
                        <div class="fs-5 fw-semibold text-truncate" title={String(config.name ?? '')}>
                          {String(config.name ?? '(unnamed)')}
                        </div>
                        <div class="text-body-secondary small text-truncate">{typeLabel(config.type)}</div>
                      </div>
                    </div>
                    {(serviceCount > 0 || summary.total > 0) && (
                      <div class="d-flex flex-wrap gap-1 mt-2">
                        {serviceCount > 0 && (
                          <span class="badge text-bg-secondary" title="Grouped services">
                            {serviceCount} services
                          </span>
                        )}
                        {summary.total > 0 && (
                          <span
                            class={`badge ${summary.errors.length > 0 ? 'text-bg-danger' : 'text-bg-warning'}`}
                            title={findings.join('\n')}
                          >
                            {summary.total} {summary.total === 1 ? 'issue' : 'issues'}
                          </span>
                        )}
                      </div>
                    )}
                    <div class="mt-auto pt-3">
                      <button class="btn btn-outline-primary w-100" onClick={() => onEdit(index)}>
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div class="d-flex align-items-center gap-2 mt-3">
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
