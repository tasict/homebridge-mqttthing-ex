// Choose which accessories move into the platform block, see exactly what
// will happen, confirm, and get the result on the same page.
//
// Accessories that cannot be moved are shown as such before the action rather
// than reported afterwards, so the child-bridge exception is never a surprise.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import {
  commonBrokerOf,
  connectionEstimate,
  hoistBrokerToPlatform,
  migrateSelected,
  moveEligibility,
  type DeviceStore,
  type MigrateAllResult,
} from '../lib/store-ops.js';
import { TypeIcon } from './TypeIcon.js';

interface Props {
  store: DeviceStore;
  onBack: () => void;
  onMigrated: () => void;
}

export function MigrationView({ store, onBack, onMigrated }: Props) {
  const candidates = store.legacy.map((config) => ({ config, eligibility: moveEligibility(store, config) }));
  const movable = candidates.filter((c) => c.eligibility.movable).map((c) => c.config);

  const [selected, setSelected] = useState<Set<ThingConfig>>(() => new Set(movable));
  const [stage, setStage] = useState<'pick' | 'confirm' | 'done'>('pick');
  const [result, setResult] = useState<MigrateAllResult | null>(null);
  const [hoistBroker, setHoistBroker] = useState(true);

  const chosen = movable.filter((config) => selected.has(config));
  const estimate = connectionEstimate(chosen);
  const shared = commonBrokerOf(chosen);
  const canHoist = shared !== null && (store.platform === null || store.platform.url === undefined);
  const blocked = candidates.filter((c) => !c.eligibility.movable);

  const toggle = (config: ThingConfig) => {
    const next = new Set(selected);
    if (next.has(config)) {
      next.delete(config);
    } else {
      next.add(config);
    }
    setSelected(next);
  };

  const run = () => {
    const outcome = migrateSelected(store, chosen);
    if (outcome.migrated > 0 && hoistBroker && canHoist && shared) {
      hoistBrokerToPlatform(store, chosen, shared);
    }
    setResult(outcome);
    setStage('done');
    onMigrated();
  };

  if (stage === 'done' && result !== null) {
    return (
      <div>
        <div class="mb-3">
          <h5 class="m-0">Moved to platform mode</h5>
        </div>
        <div class="alert alert-success">
          <strong>
            {result.migrated} {result.migrated === 1 ? 'accessory' : 'accessories'} moved to platform mode.
          </strong>
          <div class="mt-1">
            Nothing has been written yet. Use <strong>Save all changes</strong> at the top of this page, then restart
            Homebridge.
          </div>
        </div>
        {result.skipped.length > 0 && (
          <div class="card mb-3">
            <div class="card-body">
              <div class="fw-semibold mb-2">Not moved ({result.skipped.length})</div>
              <ul class="m-0 ps-3">
                {result.skipped.map((entry) => (
                  <li key={entry.name}>
                    {entry.name} — {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <button type="button" class="btn btn-primary" onClick={onBack}>
          Back to devices
        </button>
      </div>
    );
  }

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onBack}>
          ← All accessories
        </button>
        <h5 class="m-0 mt-1">Move to platform mode</h5>
        <div class="mqx-desc mt-1">
          Pick the accessories to move. Each keeps its HomeKit identity, so rooms, scenes and automations are
          preserved. Nothing is written until you save.
        </div>
      </div>

      <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick={() => setSelected(new Set(movable))}>
          Select all
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick={() => setSelected(new Set())}>
          Select none
        </button>
        <span class="text-body-secondary small ms-auto">
          {chosen.length} of {movable.length} selected
        </span>
      </div>

      <div class="row row-cols-2 row-cols-md-4 row-cols-xl-6 g-2 mb-3">
        {candidates.map(({ config, eligibility }, index) => {
          const model = getTypeModel(config.type);
          const isSelected = selected.has(config);
          return (
            <div key={index} class="col">
              <div
                class={`card h-100 ${eligibility.movable ? 'mqx-acc-card' : 'mqx-card-muted'}`}
                onClick={eligibility.movable ? () => toggle(config) : undefined}
              >
                <div class="card-body d-flex flex-column p-2">
                  <div class="d-flex align-items-start gap-2">
                    {eligibility.movable && (
                      <input
                        type="checkbox"
                        class="form-check-input mt-1 flex-shrink-0"
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(config)}
                      />
                    )}
                    <div class="mqx-card-icon flex-shrink-0">
                      <TypeIcon type={config.type} size={20} />
                    </div>
                    <div class="flex-grow-1 overflow-hidden">
                      <div class="fw-semibold text-truncate" title={String(config.name ?? '')}>
                        {String(config.name ?? '(unnamed)')}
                      </div>
                      <div class="text-body-secondary small text-truncate">
                        {model ? model.label : String(config.type ?? '')}
                      </div>
                    </div>
                  </div>
                  {!eligibility.movable && <div class="mqx-desc mt-2">Cannot be moved: {eligibility.reason}.</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <div class="fw-semibold mb-2">What will happen</div>
          <ul class="m-0 ps-3">
            <li>
              {chosen.length} {chosen.length === 1 ? 'accessory moves' : 'accessories move'} into the platform block.
            </li>
            {chosen.length > 0 && (
              <li>
                MQTT connections: {estimate.before} today → {estimate.after} after the move.
              </li>
            )}
            {blocked.length > 0 && (
              <li>
                {blocked.length} {blocked.length === 1 ? 'accessory stays' : 'accessories stay'} in accessory mode
                (listed above).
              </li>
            )}
            <li>Nothing is written to config.json until you save.</li>
          </ul>
          {canHoist && chosen.length > 1 && (
            <div class="form-check mt-2">
              <input
                class="form-check-input"
                type="checkbox"
                id="mqx-hoist-broker"
                checked={hoistBroker}
                onChange={(e) => setHoistBroker((e.currentTarget as HTMLInputElement).checked)}
              />
              <label class="form-check-label" for="mqx-hoist-broker">
                Use <span class="mqx-mono">{shared?.url}</span> as the platform&apos;s broker and remove it from each
                device
                <div class="mqx-desc">Keeps the block tidy. Any device can still override it later.</div>
              </label>
            </div>
          )}
        </div>
      </div>

      {stage === 'confirm' ? (
        <div class="alert alert-warning">
          <div class="fw-semibold mb-1">
            Move {chosen.length} {chosen.length === 1 ? 'accessory' : 'accessories'} to platform mode?
          </div>
          <div class="mb-2">
            They keep their HomeKit identity, so nothing has to be paired again. This only changes the working copy —
            nothing is written to config.json until you save, and closing this window discards it.
          </div>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-sm btn-primary" onClick={run}>
              Yes, move them
            </button>
            <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setStage('pick')}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="d-flex gap-2">
          <button
            type="button"
            class="btn btn-primary"
            disabled={chosen.length === 0}
            onClick={() => setStage('confirm')}
          >
            Move {chosen.length} {chosen.length === 1 ? 'accessory' : 'accessories'}
          </button>
          <button type="button" class="btn btn-outline-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
