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
  deviceCounts,
  ensurePlatformBlock,
  mostCommonBrokerOf,
  newDeviceId,
  seedOf,
  type DeviceStore,
} from '../lib/store-ops.js';
import type { Touch } from '../app.js';
import { TypeIcon } from './TypeIcon.js';

interface Props {
  store: DeviceStore;
  platformAvailable: boolean;
  touch: Touch;
  onCancel: () => void;
  onCreated: (config: ThingConfig) => void;
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

export function AddWizard({ store, platformAvailable, touch, onCancel, onCreated }: Props) {
  const [type, setType] = useState<string | null>(null);
  const broker = mostCommonBrokerOf(store);
  const counts = deviceCounts(store);
  // legacy creation is only offered while nothing has been migrated yet
  const canChooseLegacy = platformAvailable && store.platform === null && counts.legacy > 0;
  const [name, setName] = useState('');
  const [asLegacy, setAsLegacy] = useState(!platformAvailable);
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
      touch('legacy');
    } else {
      const block = ensurePlatformBlock(store);
      entry.id = newDeviceId(entry.name, block.devices.map((device) => seedOf(device)));
      block.devices.push(entry);
      touch('platform');
    }
    onCreated(entry);
  };

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onCancel}>
          ← All devices
        </button>
        <h5 class="m-0 mt-1">Add device</h5>
      </div>

      {type === null && (
        <div>
          <p class="text-body-secondary">Choose the device type:</p>
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
            {canChooseLegacy && (
              <div class="form-check mb-3">
                <input
                  class="form-check-input"
                  type="checkbox"
                  id="mqx-as-legacy"
                  checked={asLegacy}
                  onChange={(e) => setAsLegacy((e.currentTarget as HTMLInputElement).checked)}
                />
                <label class="form-check-label" for="mqx-as-legacy">
                  Create as a legacy accessory block
                  <div class="mqx-desc">
                    Not recommended - for setups that have not moved to platform mode yet. Once a platform block
                    exists, new devices are always created in it.
                  </div>
                </label>
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
