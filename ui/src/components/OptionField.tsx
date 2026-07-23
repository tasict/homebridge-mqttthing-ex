// Model-driven widget for one top-level configuration option. Commits on
// the native change event (blur/Enter) and mutates only its own key; a
// reset button removes the key so the runtime default applies again.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import type { OptionModel } from '../../../src/model/model-types.js';
import { setOption } from '../lib/config-ops.js';

interface Props {
  option: OptionModel;
  config: ThingConfig;
  touch: () => void;
}

function parseCommaList(text: string): string[] {
  const parts = text.split(',').map((s) => s.trim());
  while (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/** JSON editor for object-typed options; keeps invalid drafts local. */
function JsonValueEditor({ option, config, touch }: Props) {
  const raw = config[option.key];
  const [draft, setDraft] = useState<string>(raw === undefined ? '' : JSON.stringify(raw, null, 2));
  const [error, setError] = useState<string | null>(null);

  const commit = (text: string) => {
    if (text.trim() === '') {
      setOption(config, option.key, undefined);
      setError(null);
      touch();
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      setOption(config, option.key, parsed);
      setError(null);
      touch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <textarea
        class={`form-control form-control-sm mqx-mono${error ? ' is-invalid' : ''}`}
        rows={3}
        value={draft}
        onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
        onChange={(e) => commit((e.currentTarget as HTMLTextAreaElement).value)}
        placeholder="JSON"
      />
      {error && <div class="invalid-feedback d-block">{error}</div>}
    </div>
  );
}

export function OptionField({ option, config, touch }: Props) {
  const raw = config[option.key];
  const present = Object.prototype.hasOwnProperty.call(config, option.key);

  const commitValue = (value: unknown) => {
    setOption(config, option.key, value);
    touch();
  };

  let widget;
  switch (option.type) {
    case 'boolean':
      widget = (
        <div class="form-check">
          <input
            type="checkbox"
            class="form-check-input"
            id={`opt-${option.key}`}
            checked={Boolean(raw ?? option.default ?? false)}
            onChange={(e) => commitValue((e.currentTarget as HTMLInputElement).checked)}
          />
        </div>
      );
      break;
    case 'integer':
    case 'number':
      widget = (
        <input
          type="number"
          step={option.type === 'integer' ? 1 : 'any'}
          class="form-control form-control-sm"
          value={typeof raw === 'number' ? raw : ''}
          placeholder={option.default !== undefined ? String(option.default) : ''}
          onChange={(e) => {
            const text = (e.currentTarget as HTMLInputElement).value.trim();
            const num = option.type === 'integer' ? parseInt(text, 10) : parseFloat(text);
            commitValue(text === '' || Number.isNaN(num) ? undefined : num);
          }}
        />
      );
      break;
    case 'enum':
      widget = (
        <select
          class="form-select form-select-sm"
          value={typeof raw === 'string' ? raw : ''}
          onChange={(e) => commitValue((e.currentTarget as HTMLSelectElement).value || undefined)}
        >
          <option value="">{option.default !== undefined ? `(default: ${String(option.default)})` : '(unset)'}</option>
          {(option.enumValues ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
      break;
    case 'stringArray': {
      const isFlat = raw === undefined || (Array.isArray(raw) && raw.every((item) => typeof item === 'string'));
      if (!isFlat) {
        // e.g. switchValues as an array of arrays - edit as JSON instead
        widget = <JsonValueEditor key={JSON.stringify(raw) ?? 'unset'} option={option} config={config} touch={touch} />;
      } else {
        widget = (
          <input
            type="text"
            class="form-control form-control-sm mqx-mono"
            value={Array.isArray(raw) ? raw.join(', ') : ''}
            placeholder={Array.isArray(option.default) ? (option.default as string[]).join(', ') : 'comma-separated values'}
            onChange={(e) => {
              const text = (e.currentTarget as HTMLInputElement).value;
              commitValue(text.trim() === '' ? undefined : parseCommaList(text));
            }}
          />
        );
      }
      break;
    }
    case 'object':
      // keyed by the committed value: a successful commit or an external
      // change remounts the editor with a freshly formatted draft
      widget = <JsonValueEditor key={JSON.stringify(raw) ?? 'unset'} option={option} config={config} touch={touch} />;
      break;
    case 'string':
    default:
      widget = (
        <input
          type="text"
          class="form-control form-control-sm"
          value={typeof raw === 'string' ? raw : ''}
          placeholder={option.default !== undefined ? String(option.default) : ''}
          onChange={(e) => commitValue((e.currentTarget as HTMLInputElement).value.trim() || undefined)}
        />
      );
      break;
  }

  return (
    <div class="row mb-2 align-items-center">
      <div class="col-sm-4">
        <label class="form-label mb-0" for={`opt-${option.key}`}>
          {option.label} <span class="mqx-key mqx-mono">{option.key}</span>
        </label>
      </div>
      <div class="col-sm-7">{widget}</div>
      <div class="col-sm-1 text-end">
        {present && (
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm"
            title="Remove from config (use the default)"
            onClick={() => {
              setOption(config, option.key, undefined);
              touch();
            }}
          >
            ↺
          </button>
        )}
      </div>
      {option.description && <div class="col-sm-8 offset-sm-4 mqx-desc">{option.description}</div>}
    </div>
  );
}
