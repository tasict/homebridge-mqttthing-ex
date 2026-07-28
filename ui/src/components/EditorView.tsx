// View B - the accessory editor: collapsible cards for identity, MQTT
// connection, topics (model-driven table), type-specific options, advanced
// settings, custom sub-services and a JSON escape hatch. Validation
// findings are shown but never block saving. Duplicate and delete (with a
// two-click confirm) live in the header here, keeping the list cards clean.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import { hb } from '../homebridge.js';
import { changeAccessoryType, setOption } from '../lib/config-ops.js';
import {
  duplicateDevice,
  effectiveBroker,
  migrateDevice,
  removeDevice,
  sourceOf,
  type DeviceStore,
} from '../lib/store-ops.js';
import { summarizeConfig } from '../lib/validation.js';
import type { Touch } from '../app.js';
import { AdvancedSection } from './AdvancedSection.js';
import { JsonEditor } from './JsonEditor.js';
import { MqttSection } from './MqttSection.js';
import { OptionField } from './OptionField.js';
import { Section } from './Section.js';
import { ServicesSection } from './ServicesSection.js';
import { TopicsTable } from './TopicsTable.js';
import { TypeSelect } from './TypeSelect.js';

interface Props {
  config: ThingConfig;
  store: DeviceStore;
  platformAvailable: boolean;
  touch: Touch;
  onBack: () => void;
  /** Open the editor for another device (used after duplicating). */
  onOpen: (config: ThingConfig) => void;
}

export function EditorView({ config, store, platformAvailable, touch, onBack, onOpen }: Props) {
  // Two-click delete and move: the first click arms the button, the second
  // acts. The armed state falls back to normal after a few seconds, and
  // resets whenever the editor switches to another device.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setConfirmDelete(false);
    setConfirmMove(false);
    return () => {
      for (const timer of [confirmTimer, moveTimer]) {
        if (timer.current !== null) {
          clearTimeout(timer.current);
        }
      }
    };
  }, [config]);

  const source = sourceOf(store, config);
  const scope = source === 'platform' ? 'platform' : 'legacy';
  const touchOwn = () => touch(scope);

  const arm = (
    timer: typeof confirmTimer,
    set: (value: boolean) => void,
  ) => {
    set(true);
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      set(false);
    }, 4000);
  };

  const duplicate = () => {
    const copy = duplicateDevice(store, config);
    if (!copy) {
      return;
    }
    touchOwn();
    onOpen(copy);
  };

  const remove = () => {
    if (!confirmDelete) {
      arm(confirmTimer, setConfirmDelete);
      return;
    }
    if (removeDevice(store, config)) {
      touchOwn();
    }
    onBack();
  };

  const move = () => {
    if (!confirmMove) {
      arm(moveTimer, setConfirmMove);
      return;
    }
    setConfirmMove(false);
    const name = String(config.name ?? '');
    const result = migrateDevice(store, config);
    if (!result.ok) {
      hb().toast.error(result.reason, `"${name}" was not moved`);
      return;
    }
    touch('legacy');
    touch('platform');
    hb().toast.success(
      `Moved "${name}" to the platform block (id: ${result.id}). Click Save changes to write it.`,
    );
  };

  const model = getTypeModel(config.type);
  const isCustom = model?.id === 'custom';
  const summary = summarizeConfig(config);
  // 'services' (custom) and 'zones' (irrigationSystem) get dedicated or
  // JSON-based editing anyway; keep every other model option here.
  const optionModels = (model?.options ?? []).filter((o) => !(isCustom && o.key === 'services'));

  const broker = effectiveBroker(store, config);
  const mqttSummary = `${broker.url !== undefined ? broker.url : 'default broker'}${
    broker.username !== undefined ? ` · ${broker.username}` : ''
  }`;

  return (
    <div>
      <div class="mb-3 d-flex flex-wrap align-items-end gap-2">
        <div class="flex-grow-1">
          <button type="button" class="btn btn-link btn-sm p-0" onClick={onBack}>
            ← All devices
          </button>
          <h5 class="m-0 mt-1">
            {String(config.name ?? '(unnamed)')}{' '}
            <span class="text-body-secondary fw-normal">{model ? model.label : String(config.type ?? '')}</span>{' '}
            {source === 'platform' ? (
              <span class="badge text-bg-info align-middle">Platform</span>
            ) : (
              <span class="badge text-bg-secondary align-middle">Legacy</span>
            )}
          </h5>
        </div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-outline-secondary" title="Create a copy of this device and edit it" onClick={duplicate}>
            Duplicate
          </button>
          {source === 'accessory' && platformAvailable && (
            <button
              type="button"
              class={`btn ${confirmMove ? 'btn-primary' : 'btn-outline-primary'}`}
              title="Moves this accessory into the platform block and pins its HomeKit identity. Nothing is written until you save."
              onClick={move}
            >
              {confirmMove ? 'Confirm move?' : 'Move to platform'}
            </button>
          )}
          <button
            type="button"
            class={`btn ${confirmDelete ? 'btn-danger' : 'btn-outline-danger'}`}
            title="Removed from the staged config; nothing is written until you save"
            onClick={remove}
          >
            {confirmDelete ? 'Confirm delete?' : 'Delete'}
          </button>
        </div>
      </div>

      {summary.total > 0 && (
        <div class={`alert py-2 ${summary.errors.length > 0 ? 'alert-danger' : 'alert-warning'}`}>
          <ul class="m-0 ps-3">
            {summary.errors.map((message, i) => (
              <li key={`e${i}`}>
                <strong>Error:</strong> {message}
              </li>
            ))}
            {summary.warnings.map((message, i) => (
              <li key={`w${i}`}>{message}</li>
            ))}
          </ul>
          <div class="mqx-desc mt-1">Warnings never block saving; unknown keys are always preserved.</div>
        </div>
      )}

      <Section title="Identity" defaultOpen>
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label mb-0">Name</label>
            <input
              type="text"
              class="form-control form-control-sm"
              value={typeof config.name === 'string' ? config.name : ''}
              onChange={(e) => {
                setOption(config, 'name', (e.currentTarget as HTMLInputElement).value.trim() || undefined);
                touchOwn();
              }}
            />
          </div>
          <div class="col-md-6">
            <label class="form-label mb-0">Type</label>
            <TypeSelect
              value={typeof config.type === 'string' ? config.type : undefined}
              onSelect={(id) => {
                if (id === config.type) {
                  return;
                }
                const dropped = changeAccessoryType(config, id);
                touchOwn();
                if (dropped.length > 0) {
                  hb().toast.info(`Removed topics not supported by the new type: ${dropped.join(', ')}`);
                }
              }}
            />
          </div>
        </div>
        {source === 'platform' && typeof config.id === 'string' && (
          <div class="mt-2">
            <label class="form-label mb-0">Device id</label>
            <input type="text" class="form-control form-control-sm mqx-mono" value={config.id} readOnly />
            <div class="mqx-desc mt-1">
              This device&apos;s stable HomeKit identity. Renaming the device is safe; the id can only be changed
              under &quot;Edit as JSON&quot;, where HomeKit will treat the result as a new device.
            </div>
          </div>
        )}
        {model?.notes && <div class="mqx-desc mt-2">{model.notes}</div>}
      </Section>

      <Section title="MQTT connection" summary={mqttSummary}>
        <MqttSection config={config} store={store} touch={touch} />
      </Section>

      {!isCustom && (
        <Section title="Topics" defaultOpen>
          <TopicsTable owner={config} broker={broker} touch={touchOwn} />
        </Section>
      )}

      {isCustom && (
        <Section title="Services" defaultOpen badge={<span class="badge text-bg-secondary">{Array.isArray(config.services) ? config.services.length : 0}</span>}>
          <ServicesSection config={config} touch={touchOwn} />
        </Section>
      )}

      {optionModels.length > 0 && (
        <Section title={`${model?.label ?? 'Type'} options`}>
          {optionModels.map((option) => (
            <OptionField key={option.key} option={option} config={config} touch={touchOwn} />
          ))}
        </Section>
      )}

      <Section title="Advanced">
        <AdvancedSection config={config} touch={touchOwn} />
      </Section>

      <Section title="Edit as JSON" summary="escape hatch: the raw device config">
        <JsonEditor config={config} source={source ?? 'accessory'} touch={touchOwn} />
      </Section>
    </div>
  );
}
