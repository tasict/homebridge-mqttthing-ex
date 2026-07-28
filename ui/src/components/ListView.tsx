// View A - the device list: search, type filter, sort and add on top of a
// responsive card grid (one device per card, opened via a single Edit
// button). Duplicate, delete and moving to platform mode live in the editor;
// the raw config order is preserved as the default sort.
//
// Devices come from both containers: accessory blocks and the platform
// block's devices[]. Someone using only accessory blocks sees the list they
// have always seen; the only addition is one link in the footer.
import { ListFilter, Pencil, Settings } from 'lucide-preact';
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import { matchesSearch } from '../lib/config-ops.js';
import { introSeen } from '../lib/prefs.js';
import {
  allDevices,
  configShape,
  deviceCounts,
  duplicateIdentityFindings,
  type DeviceSource,
  type DeviceStore,
} from '../lib/store-ops.js';
import { plural, termsFor } from '../lib/terms.js';
import { summarizeConfig } from '../lib/validation.js';
import { hb } from '../homebridge.js';
import { TypeIcon } from './TypeIcon.js';

type SortMode = 'config' | 'name' | 'type';

interface Props {
  store: DeviceStore;
  /** Why legacy accessory blocks are unavailable, or null when they work. */
  legacyUnavailable: string | null;
  onEdit: (config: ThingConfig) => void;
  onAdd: () => void;
  onPlatformSettings: () => void;
  onPlatformIntro: () => void;
  onMigrate: () => void;
}

function typeLabel(type: string | undefined): string {
  const model = getTypeModel(type);
  if (!model) {
    return type ? `${type} (unknown)` : '(no type)';
  }
  return model.id === type ? model.label : `${model.label} (${type})`;
}

export function ListView({
  store,
  legacyUnavailable,
  onEdit,
  onAdd,
  onPlatformSettings,
  onPlatformIntro,
  onMigrate,
}: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('config');
  const [showJson, setShowJson] = useState(false);

  // The working copy is mutated in place (stable identity), so this is
  // recomputed on every render instead of memoized.
  const devices = allDevices(store);
  const counts = deviceCounts(store);
  const shape = configShape(store);
  const terms = termsFor(shape);
  const findings = duplicateIdentityFindings(store);
  const showSource = shape === 'mixed';

  const presentTypes: string[] = [];
  for (const { config } of devices) {
    const base = getTypeModel(config.type)?.id ?? String(config.type ?? '');
    if (base && !presentTypes.includes(base)) {
      presentTypes.push(base);
    }
  }
  presentTypes.sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

  let entries = devices
    .filter((e) => matchesSearch(e.config, query))
    .filter((e) => typeFilter === '' || (getTypeModel(e.config.type)?.id ?? String(e.config.type ?? '')) === typeFilter);
  if (sortMode === 'name') {
    entries = [...entries].sort((a, b) => String(a.config.name ?? '').localeCompare(String(b.config.name ?? '')));
  } else if (sortMode === 'type') {
    entries = [...entries].sort((a, b) => typeLabel(a.config.type).localeCompare(typeLabel(b.config.type)));
  }

  const platformLink = shape === 'accessory' || shape === 'mixed';

  const buildJson = () =>
    shape === 'accessory'
      ? JSON.stringify(store.legacy, null, 2)
      : JSON.stringify(
          { accessories: store.legacy, platforms: store.platform === null ? [] : [store.platform] },
          null,
          2,
        );

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(buildJson());
      hb().toast.success('Configuration copied to the clipboard');
    } catch {
      hb().toast.error('Could not access the clipboard');
    }
  };

  const sourceLabel = (source: DeviceSource) => (
    <span class="mqx-key" title={source === 'platform' ? 'In the platform block' : 'Its own accessory block'}>
      {source === 'platform' ? 'Platform' : 'Accessory'}
    </span>
  );

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
        {/* custom dropdown instead of a native select so each type entry can
            show its icon (native <option> cannot contain SVG) */}
        <div class="mqx-type-select w-auto">
          <button
            type="button"
            class="form-select text-start d-flex align-items-center gap-2 mqx-filter-btn"
            onClick={() => setFilterOpen(!filterOpen)}
          >
            {typeFilter === '' ? (
              <ListFilter size={16} class="flex-shrink-0" />
            ) : (
              <TypeIcon type={typeFilter} size={16} class="flex-shrink-0" />
            )}
            <span class="text-truncate">{typeFilter === '' ? 'All types' : typeLabel(typeFilter)}</span>
          </button>
          {filterOpen && (
            <>
              <div class="mqx-backdrop" onClick={() => setFilterOpen(false)} />
              <div class="mqx-type-menu card">
                <div class="list-group list-group-flush">
                  <button
                    type="button"
                    class={`list-group-item list-group-item-action d-flex align-items-center gap-2${typeFilter === '' ? ' fw-bold' : ''}`}
                    onClick={() => {
                      setTypeFilter('');
                      setFilterOpen(false);
                    }}
                  >
                    <ListFilter size={16} class="flex-shrink-0" />
                    <span>All types</span>
                  </button>
                  {presentTypes.map((id) => (
                    <button
                      key={id}
                      type="button"
                      class={`list-group-item list-group-item-action d-flex align-items-center gap-2${typeFilter === id ? ' fw-bold' : ''}`}
                      onClick={() => {
                        setTypeFilter(id);
                        setFilterOpen(false);
                      }}
                    >
                      <TypeIcon type={id} size={16} class="flex-shrink-0" />
                      <span>{typeLabel(id)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <select
          class="form-select w-auto"
          value={sortMode}
          onChange={(e) => setSortMode((e.currentTarget as HTMLSelectElement).value as SortMode)}
        >
          <option value="config">Config order</option>
          <option value="name">Sort by name</option>
          <option value="type">Sort by type</option>
        </select>
        {store.platform !== null && (
          <button
            type="button"
            class="btn btn-outline-secondary d-flex align-items-center gap-1"
            title="Platform settings"
            onClick={onPlatformSettings}
          >
            <Settings size={16} />
            <span class="d-none d-md-inline">Platform settings</span>
          </button>
        )}
        <button class="btn btn-primary" onClick={onAdd}>
          + {terms.addLabel}
        </button>
      </div>

      {counts.total === 0 && (
        <div class="alert alert-info">
          No mqttthing {terms.plural} configured yet. Use <strong>{terms.addLabel}</strong> to create the first one.
        </div>
      )}
      {counts.total > 0 && entries.length === 0 && (
        <div class="alert alert-secondary">No {terms.plural} match the current search.</div>
      )}

      {entries.length > 0 && (
        <div class="row row-cols-2 row-cols-md-4 row-cols-xl-6 g-2">
          {entries.map(({ config, source }, position) => {
            const summary = summarizeConfig(config);
            const finding = findings.get(config);
            const messages = [...summary.errors, ...summary.warnings, ...(finding ? [finding] : [])];
            const issues = summary.total + (finding ? 1 : 0);
            const serviceCount = Array.isArray(config.services) ? config.services.length : 0;
            return (
              <div key={position} class="col">
                {/* the whole card is a pointer shortcut; the pencil button is the accessible control */}
                <div class="card h-100 mqx-acc-card" onClick={() => onEdit(config)}>
                  <div class="card-body d-flex flex-column p-2">
                    <div class="d-flex align-items-start gap-2">
                      <div class="mqx-card-icon flex-shrink-0">
                        <TypeIcon type={config.type} size={22} />
                      </div>
                      <div class="flex-grow-1 overflow-hidden">
                        <div class="fw-semibold text-truncate" title={String(config.name ?? '')}>
                          {String(config.name ?? '(unnamed)')}
                        </div>
                        <div class="text-body-secondary small text-truncate">{typeLabel(config.type)}</div>
                      </div>
                      <button
                        class="btn btn-outline-primary btn-sm mqx-edit-btn flex-shrink-0"
                        aria-label="Edit"
                        title="Edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(config);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    {(showSource || serviceCount > 0 || issues > 0) && (
                      <div class="d-flex flex-wrap align-items-center gap-1 mt-2">
                        {showSource && sourceLabel(source)}
                        {serviceCount > 0 && (
                          <span class="badge text-bg-secondary" title="Grouped services">
                            {serviceCount} services
                          </span>
                        )}
                        {issues > 0 && (
                          <span
                            class={`badge ${summary.errors.length > 0 ? 'text-bg-danger' : 'text-bg-warning'}`}
                            title={messages.join('\n')}
                          >
                            {issues} {issues === 1 ? 'issue' : 'issues'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div class="d-flex flex-wrap align-items-center gap-2 mt-3">
        <span class="text-body-secondary small">
          {entries.length !== counts.total
            ? `${entries.length} of ${plural(counts.total, terms)}`
            : showSource
              ? `${plural(counts.total, terms)} — ${counts.legacy} in accessory mode, ${counts.platform} in platform mode`
              : plural(counts.total, terms)}
        </span>
        {platformLink && shape === 'accessory' && (
          <button class="btn btn-link btn-sm ms-auto p-0" onClick={onPlatformIntro}>
            About platform mode
            {!introSeen() && <span class="badge text-bg-secondary ms-1">New</span>}
          </button>
        )}
        {platformLink && shape === 'mixed' && (
          <button class="btn btn-link btn-sm ms-auto p-0" onClick={onMigrate}>
            Move accessories to platform mode
          </button>
        )}
        <button
          class={`btn btn-link btn-sm p-0${platformLink ? '' : ' ms-auto'}`}
          onClick={() => setShowJson(!showJson)}
        >
          {showJson ? 'Hide JSON' : 'View JSON'}
        </button>
      </div>
      {legacyUnavailable !== null && (
        <div class="mqx-desc mt-1">Legacy accessory blocks are unavailable: {legacyUnavailable}</div>
      )}
      {showJson && (
        <div class="mt-2">
          <textarea class="form-control mqx-json-view" rows={16} readOnly value={buildJson()} />
          <button class="btn btn-outline-secondary btn-sm mt-1" onClick={copyJson}>
            Copy to clipboard
          </button>
        </div>
      )}
    </div>
  );
}
