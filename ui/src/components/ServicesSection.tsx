// Services card for the 'custom' accessory type: a list of sub-service
// editors, each with its own type, name, subtype, topic table and
// type-specific options. Accessory-level settings act as inherited
// defaults for every service.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import { hb } from '../homebridge.js';
import { changeAccessoryType, setOption } from '../lib/config-ops.js';
import { OptionField } from './OptionField.js';
import { TopicsTable } from './TopicsTable.js';
import { TypeSelect } from './TypeSelect.js';

interface Props {
  config: ThingConfig;
  touch: () => void;
}

const STRUCTURAL_KEYS = new Set(['accessory', 'type', 'name', 'services', 'topics', 'subtype', '_bridge']);

function ServiceEditor({
  service,
  parent,
  touch,
  onRemove,
}: {
  service: ThingConfig;
  parent: ThingConfig;
  touch: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const model = getTypeModel(service.type);

  return (
    <div class="card mb-2">
      <div class="card-header d-flex align-items-center gap-2" role="button" onClick={() => setOpen(!open)}>
        <span class="text-body-secondary" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span class="fw-semibold">{String(service.name ?? '(unnamed service)')}</span>
        <span class="mqx-key">{model ? model.label : String(service.type ?? '(no type)')}</span>
        <button
          type="button"
          class="btn btn-outline-danger btn-sm ms-auto"
          title="Remove this service"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      </div>
      {open && (
        <div class="card-body">
          <div class="row g-2 mb-3">
            <div class="col-md-4">
              <label class="form-label mb-0">Name</label>
              <input
                type="text"
                class="form-control form-control-sm"
                value={typeof service.name === 'string' ? service.name : ''}
                onChange={(e) => {
                  setOption(service, 'name', (e.currentTarget as HTMLInputElement).value.trim() || undefined);
                  touch();
                }}
              />
            </div>
            <div class="col-md-4">
              <label class="form-label mb-0">Type</label>
              <TypeSelect
                value={typeof service.type === 'string' ? service.type : undefined}
                excludeCustom
                onSelect={(id) => {
                  if (id === service.type) {
                    return;
                  }
                  const dropped = changeAccessoryType(service, id);
                  touch();
                  if (dropped.length > 0) {
                    hb().toast.info(`Removed topics not supported by the new type: ${dropped.join(', ')}`);
                  }
                }}
              />
            </div>
            <div class="col-md-4">
              <label class="form-label mb-0">
                Subtype <span class="mqx-desc">(defaults to the name)</span>
              </label>
              <input
                type="text"
                class="form-control form-control-sm"
                value={typeof service.subtype === 'string' ? service.subtype : ''}
                onChange={(e) => {
                  setOption(service, 'subtype', (e.currentTarget as HTMLInputElement).value.trim() || undefined);
                  touch();
                }}
              />
            </div>
          </div>
          <h6 class="mb-1">Topics</h6>
          <TopicsTable owner={service} broker={parent} touch={touch} />
          {model && model.options.length > 0 && (
            <>
              <h6 class="mb-1 mt-3">{model.label} options</h6>
              {model.options.map((option) => (
                <OptionField key={option.key} option={option} config={service} touch={touch} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ServicesSection({ config, touch }: Props) {
  const services = Array.isArray(config.services) ? config.services : [];
  const inherited = Object.keys(config).filter((key) => !STRUCTURAL_KEYS.has(key));

  const addService = () => {
    if (!Array.isArray(config.services)) {
      config.services = [];
    }
    config.services.push({ type: 'switch', name: `Service ${config.services.length + 1}`, topics: {} } as ThingConfig);
    touch();
  };

  const removeService = (index: number) => {
    const name = String(services[index]?.name ?? `#${index + 1}`);
    if (window.confirm(`Remove service "${name}"?`)) {
      services.splice(index, 1);
      touch();
    }
  };

  return (
    <div>
      <p class="mqx-desc">
        A custom accessory groups several simple services into one HomeKit accessory. Every accessory-level setting acts
        as an inherited default that each service may override.
        {inherited.length > 0 && (
          <>
            {' '}
            Currently inherited: <span class="mqx-mono">{inherited.join(', ')}</span>
          </>
        )}
      </p>
      {services.length === 0 && <div class="alert alert-warning py-2">A custom accessory needs at least one service.</div>}
      {services.map((service, index) => (
        <ServiceEditor
          key={index}
          service={service}
          parent={config}
          touch={touch}
          onRemove={() => removeService(index)}
        />
      ))}
      <button type="button" class="btn btn-outline-secondary btn-sm" onClick={addService}>
        + Add service
      </button>
    </div>
  );
}
