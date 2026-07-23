// View B - the accessory editor: collapsible cards for identity, MQTT
// connection, topics (model-driven table), type-specific options, advanced
// settings, custom sub-services and a JSON escape hatch. Validation
// findings are shown but never block saving.
import type { ThingConfig } from '../../../src/config.js';
import { getTypeModel } from '../../../src/model/types.js';
import { hb } from '../homebridge.js';
import { changeAccessoryType, setOption } from '../lib/config-ops.js';
import { summarizeConfig } from '../lib/validation.js';
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
  configs: ThingConfig[];
  touch: () => void;
  onBack: () => void;
}

export function EditorView({ config, configs, touch, onBack }: Props) {
  const model = getTypeModel(config.type);
  const isCustom = model?.id === 'custom';
  const summary = summarizeConfig(config);
  // 'services' (custom) and 'zones' (irrigationSystem) get dedicated or
  // JSON-based editing anyway; keep every other model option here.
  const optionModels = (model?.options ?? []).filter((o) => !(isCustom && o.key === 'services'));

  const mqttSummary = `${typeof config.url === 'string' && config.url !== '' ? config.url : 'default broker'}${
    typeof config.username === 'string' && config.username !== '' ? ` · ${config.username}` : ''
  }`;

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onBack}>
          ← All accessories
        </button>
        <h5 class="m-0 mt-1">
          {String(config.name ?? '(unnamed)')}{' '}
          <span class="text-body-secondary fw-normal">{model ? model.label : String(config.type ?? '')}</span>
        </h5>
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
                touch();
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
                touch();
                if (dropped.length > 0) {
                  hb().toast.info(`Removed topics not supported by the new type: ${dropped.join(', ')}`);
                }
              }}
            />
          </div>
        </div>
        {model?.notes && <div class="mqx-desc mt-2">{model.notes}</div>}
      </Section>

      <Section title="MQTT connection" summary={mqttSummary}>
        <MqttSection config={config} configs={configs} touch={touch} />
      </Section>

      {!isCustom && (
        <Section title="Topics" defaultOpen>
          <TopicsTable owner={config} broker={config} touch={touch} />
        </Section>
      )}

      {isCustom && (
        <Section title="Services" defaultOpen badge={<span class="badge text-bg-secondary">{Array.isArray(config.services) ? config.services.length : 0}</span>}>
          <ServicesSection config={config} touch={touch} />
        </Section>
      )}

      {optionModels.length > 0 && (
        <Section title={`${model?.label ?? 'Type'} options`}>
          {optionModels.map((option) => (
            <OptionField key={option.key} option={option} config={config} touch={touch} />
          ))}
        </Section>
      )}

      <Section title="Advanced">
        <AdvancedSection config={config} touch={touch} />
      </Section>

      <Section title="Edit as JSON" summary="escape hatch: the raw accessory config">
        <JsonEditor config={config} touch={touch} />
      </Section>
    </div>
  );
}
