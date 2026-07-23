// Advanced card: codec picker (server-provided list with a free-text
// override), start-up publications editor and every remaining global
// option rendered from the declarative model.
import { useEffect, useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { GLOBAL_OPTIONS } from '../../../src/model/model-types.js';
import { hb } from '../homebridge.js';
import { setOption } from '../lib/config-ops.js';
import { OptionField } from './OptionField.js';

interface Props {
  config: ThingConfig;
  touch: () => void;
}

/** Keys handled by dedicated widgets or other sections. */
const HANDLED_KEYS = new Set(['url', 'username', 'password', 'codec', 'startPub']);

interface CodecList {
  builtIn: string[];
  custom: string[];
}

function CodecPicker({ config, touch }: Props) {
  const [codecs, setCodecs] = useState<CodecList>({ builtIn: ['json', 'shellyAMAX'], custom: [] });
  const [other, setOther] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hb()
      .request('/codecs')
      .then((list: CodecList) => {
        if (!cancelled && list && Array.isArray(list.builtIn) && Array.isArray(list.custom)) {
          setCodecs(list);
        }
      })
      .catch(() => undefined); // fall back to the bundled names
    return () => {
      cancelled = true;
    };
  }, []);

  const current = typeof config.codec === 'string' ? config.codec : '';
  const listed = [...codecs.builtIn, ...codecs.custom];
  const selectValue = current === '' ? '' : listed.includes(current) ? current : '__other';
  const showOther = other || selectValue === '__other';

  return (
    <div class="row mb-2 align-items-center">
      <div class="col-sm-4">
        <label class="form-label mb-0">
          Codec <span class="mqx-key mqx-mono">codec</span>
        </label>
      </div>
      <div class="col-sm-7">
        <div class="d-flex gap-2">
          <select
            class="form-select form-select-sm"
            value={showOther ? '__other' : selectValue}
            onChange={(e) => {
              const value = (e.currentTarget as HTMLSelectElement).value;
              if (value === '__other') {
                setOther(true);
              } else {
                setOther(false);
                setOption(config, 'codec', value || undefined);
                touch();
              }
            }}
          >
            <option value="">(none)</option>
            <optgroup label="Bundled codecs">
              {codecs.builtIn.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
            {codecs.custom.length > 0 && (
              <optgroup label="Homebridge storage path">
                {codecs.custom.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__other">Custom path…</option>
          </select>
          {showOther && (
            <input
              type="text"
              class="form-control form-control-sm mqx-mono"
              value={current}
              placeholder="/absolute/path/codec.js or relative-to-storage.js"
              onChange={(e) => {
                setOption(config, 'codec', (e.currentTarget as HTMLInputElement).value.trim() || undefined);
                touch();
              }}
            />
          )}
        </div>
      </div>
      <div class="col-sm-8 offset-sm-4 mqx-desc">
        JavaScript codec encoding/decoding all MQTT messages of this accessory. Names without .js refer to bundled
        codecs; other paths resolve against the Homebridge storage path.
      </div>
    </div>
  );
}

function StartPubEditor({ config, touch }: Props) {
  const startPub = config.startPub;

  if (startPub !== undefined && !Array.isArray(startPub)) {
    // legacy { topic: message } object form - preserved as-is, edited as JSON
    return (
      <OptionField
        option={{
          key: 'startPub',
          type: 'object',
          label: 'Start-up Publications',
          description: 'Legacy topic-to-message object form (still supported); edit as JSON or convert to the array form manually.',
        }}
        config={config}
        touch={touch}
      />
    );
  }

  const rows = Array.isArray(startPub) ? startPub : [];

  const commitRow = (index: number, field: 'topic' | 'message') => (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value;
    const row = rows[index];
    if (field === 'message') {
      row.message = value; // '' is meaningful: publish an empty message
    } else {
      row.topic = value.trim();
    }
    touch();
  };

  const addRow = () => {
    if (!Array.isArray(config.startPub)) {
      config.startPub = [];
    }
    config.startPub.push({ topic: '', message: '' });
    touch();
  };

  const removeRow = (index: number) => {
    rows.splice(index, 1);
    if (rows.length === 0) {
      delete config.startPub;
    }
    touch();
  };

  return (
    <div class="row mb-2">
      <div class="col-sm-4">
        <label class="form-label mb-0">
          Start-up Publications <span class="mqx-key mqx-mono">startPub</span>
        </label>
        <div class="mqx-desc">Messages published once at start-up.</div>
      </div>
      <div class="col-sm-8">
        {rows.map((row, index) => (
          <div key={index} class="d-flex gap-1 mb-1">
            <input
              type="text"
              class="form-control form-control-sm mqx-mono"
              value={typeof row.topic === 'string' ? row.topic : ''}
              placeholder="topic"
              onChange={commitRow(index, 'topic')}
            />
            <input
              type="text"
              class="form-control form-control-sm mqx-mono"
              value={typeof row.message === 'string' ? row.message : ''}
              placeholder="message"
              onChange={commitRow(index, 'message')}
            />
            <button type="button" class="btn btn-outline-danger btn-sm" title="Remove" onClick={() => removeRow(index)}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick={addRow}>
          + Add publication
        </button>
      </div>
    </div>
  );
}

export function AdvancedSection({ config, touch }: Props) {
  return (
    <div>
      <CodecPicker config={config} touch={touch} />
      <StartPubEditor config={config} touch={touch} />
      <hr class="my-3" />
      {GLOBAL_OPTIONS.filter((option) => !HANDLED_KEYS.has(option.key)).map((option) => (
        <OptionField key={option.key} option={option} config={config} touch={touch} />
      ))}
    </div>
  );
}
