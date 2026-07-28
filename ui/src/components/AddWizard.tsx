// View C - the add wizard (type-first): a category-grouped type grid, then
// name + broker URL (prefilled from the most common broker among existing
// devices). Creates the entry and opens the editor.
//
// New devices go into the platform block, which is created on first use. A
// legacy accessory block can still be created while the configuration has no
// platform block yet, for setups that have not migrated.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import type { AccessoryCategory } from '../../../src/model/model-types.js';
import { ACCESSORY_TYPES, getTypeModel } from '../../../src/model/types.js';
import {
  configShape,
  ensurePlatformBlock,
  mostCommonBrokerOf,
  newDeviceId,
  type DeviceStore,
} from '../lib/store-ops.js';
import { termsFor } from '../lib/terms.js';
import type { Touch } from '../app.js';
import { TypeIcon } from './TypeIcon.js';

interface Props {
  store: DeviceStore;
  platformAvailable: boolean;
  touch: Touch;
  onCancel: () => void;
  onCreated: (config: ThingConfig) => void;
  onPlatformIntro: () => void;
}

const CATEGORY_ORDER: AccessoryCategory[] = [
  'Lights',
  'Switches & Outlets',
  'Sensors',
  'Climate',
  'Security & Access',
  'Water',
  'Media',
  'Other',
];

export function AddWizard({ store, platformAvailable, touch, onCancel, onCreated, onPlatformIntro }: Props) {
  const [type, setType] = useState<string | null>(null);
  const broker = mostCommonBrokerOf(store);
  const shape = configShape(store);
  const terms = termsFor(shape);
  // Someone using accessory blocks keeps getting accessory blocks; the
  // alternative is offered on every screen, never withdrawn.
  const [target, setTarget] = useState<'accessory' | 'platform'>(
    !platformAvailable || shape === 'accessory' ? 'accessory' : 'platform',
  );
  const [name, setName] = useState('');
  const asLegacy = target === 'accessory';
  const platformUrl = typeof store.platform?.url === 'string' ? store.platform.url : '';
  const inheritsBroker = !asLegacy && platformUrl !== '';
  const [url, setUrl] = useState(broker?.url ?? '');

  const model = getTypeModel(type);

  const create = () => {
    if (!model || name.trim() === '') {
      return;
    }
    const entry = { type: model.id, name: name.trim() } as ThingConfig;
    if (!inheritsBroker && url.trim() !== '') {
      entry.url = url.trim();
      // carry over the credentials only when the prefilled broker is kept
      if (broker && url.trim() === broker.url) {
        if (broker.username !== undefined) {
          entry.username = broker.username;
        }
        if (broker.password !== undefined) {
          entry.password = broker.password;
        }
      }
    }
    if (model.id === 'custom') {
      entry.services = [];
    } else {
      entry.topics = {};
    }

    if (asLegacy) {
      entry.accessory = 'mqttthing';
      store.legacy.push(entry);
      touch('accessory');
    } else {
      const block = ensurePlatformBlock(store);
      entry.id = newDeviceId();
      block.devices.push(entry);
      touch('platform');
    }
    onCreated(entry);
  };

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onCancel}>
          {terms.backLabel}
        </button>
        <h5 class="m-0 mt-1">Add {terms.singular}</h5>
      </div>

      {type === null && (
        <div>
          <p class="text-body-secondary">Choose the {terms.singular} type:</p>
          {CATEGORY_ORDER.map((category) => {
            const types = ACCESSORY_TYPES.filter((t) => t.category === category);
            if (types.length === 0) {
              return null;
            }
            return (
              <div key={category} class="mb-3">
                <h6 class="mqx-type-category p-0">{category}</h6>
                <div class="mqx-wizard-grid">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      class="btn btn-outline-primary text-start d-flex align-items-center gap-2"
                      onClick={() => setType(t.id)}
                    >
                      <TypeIcon type={t.id} size={22} class="flex-shrink-0" />
                      <span class="overflow-hidden">
                        {t.label}
                        <div class="mqx-key mqx-mono text-truncate">{t.id}</div>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {type !== null && model && (
        <div class="card">
          <div class="card-body">
            <p>
              Type: <strong>{model.label}</strong>{' '}
              <button type="button" class="btn btn-link btn-sm p-0" onClick={() => setType(null)}>
                change
              </button>
            </p>
            <div class="row g-2 mb-3">
              <div class="col-md-6">
                <label class="form-label mb-0">Name</label>
                <input
                  type="text"
                  class="form-control"
                  value={name}
                  placeholder="e.g. Living Room Lamp"
                  onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                />
              </div>
              <div class="col-md-6">
                <label class="form-label mb-0">MQTT URL</label>
                {inheritsBroker ? (
                  <div class="form-control-plaintext small">
                    Uses the platform broker (<span class="mqx-mono">{platformUrl}</span>). You can override it later in
                    the editor.
                  </div>
                ) : (
                  <input
                    type="text"
                    class="form-control mqx-mono"
                    value={url}
                    placeholder="mqtt://localhost:1883"
                    onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
                  />
                )}
              </div>
            </div>
            {platformAvailable && (
              <div class="mb-3">
                <div class="mqx-desc">
                  {asLegacy
                    ? shape === 'accessory'
                      ? 'Will be added as an accessory block, like your other accessories.'
                      : 'Will be added as its own accessory block.'
                    : 'Will be added to the MQTT Thing platform block.'}
                </div>
                <button
                  type="button"
                  class="btn btn-link btn-sm p-0"
                  title={
                    asLegacy
                      ? 'Platform devices share MQTT connections and can be renamed safely'
                      : 'Only an accessory block can run in its own child bridge'
                  }
                  onClick={() => setTarget(asLegacy ? 'platform' : 'accessory')}
                >
                  {asLegacy ? 'Add as a platform device instead' : 'Add as a separate accessory block instead'}
                </button>
                {!asLegacy && shape === 'accessory' && (
                  <div class="mqx-desc mt-1">
                    This creates the platform block in config.json when you save.{' '}
                    <button type="button" class="btn btn-link btn-sm p-0 align-baseline" onClick={onPlatformIntro}>
                      About platform mode
                    </button>
                  </div>
                )}
              </div>
            )}
            <button type="button" class="btn btn-primary" disabled={name.trim() === ''} onClick={create}>
              Create and edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
