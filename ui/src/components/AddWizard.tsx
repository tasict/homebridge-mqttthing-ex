// View C - the add wizard (type-first): a category-grouped type grid, then
// name + broker URL (prefilled from the most common broker among existing
// accessories). Creates the entry and opens the editor.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import type { AccessoryCategory } from '../../../src/model/model-types.js';
import { ACCESSORY_TYPES, getTypeModel } from '../../../src/model/types.js';
import { mostCommonBroker } from '../lib/config-ops.js';
import { TypeIcon } from './TypeIcon.js';

interface Props {
  configs: ThingConfig[];
  touch: () => void;
  onCancel: () => void;
  onCreated: (index: number) => void;
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

export function AddWizard({ configs, touch, onCancel, onCreated }: Props) {
  const [type, setType] = useState<string | null>(null);
  const broker = mostCommonBroker(configs);
  const [name, setName] = useState('');
  const [url, setUrl] = useState(broker?.url ?? '');

  const model = getTypeModel(type);

  const create = () => {
    if (!model || name.trim() === '') {
      return;
    }
    const entry: ThingConfig = {
      accessory: 'mqttthing',
      type: model.id,
      name: name.trim(),
    };
    if (url.trim() !== '') {
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
    configs.push(entry);
    touch();
    onCreated(configs.length - 1);
  };

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onCancel}>
          ← All accessories
        </button>
        <h5 class="m-0 mt-1">Add accessory</h5>
      </div>

      {type === null && (
        <div>
          <p class="text-body-secondary">Choose the accessory type:</p>
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
                <input
                  type="text"
                  class="form-control mqx-mono"
                  value={url}
                  placeholder="mqtt://localhost:1883"
                  onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
                />
              </div>
            </div>
            <button type="button" class="btn btn-primary" disabled={name.trim() === ''} onClick={create}>
              Create and edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
