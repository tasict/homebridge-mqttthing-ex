// View D - the platform block's own settings: the block name and the broker
// defaults every platform device inherits unless it sets its own.
import { useState } from 'preact/hooks';

import { hb, requestErrorMessage } from '../homebridge.js';
import { setOption } from '../lib/config-ops.js';
import { deviceCounts, ensurePlatformBlock, mostCommonBrokerOf, type DeviceStore } from '../lib/store-ops.js';
import type { Touch } from '../app.js';
import { Section } from './Section.js';

interface Props {
  store: DeviceStore;
  touch: Touch;
  onBack: () => void;
}

export function PlatformSettingsView({ store, touch, onBack }: Props) {
  const block = ensurePlatformBlock(store);
  const [testing, setTesting] = useState(false);
  const [optionsDraft, setOptionsDraft] = useState(() =>
    block.mqttOptions === undefined ? '' : JSON.stringify(block.mqttOptions, null, 2),
  );
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const counts = deviceCounts(store);
  const suggestion = mostCommonBrokerOf(store);

  const commit = (key: 'name' | 'url' | 'username' | 'password') => (e: Event) => {
    setOption(block as never, key, (e.currentTarget as HTMLInputElement).value.trim() || undefined);
    touch('platform');
  };

  const applyOptions = () => {
    const text = optionsDraft.trim();
    if (text === '') {
      delete block.mqttOptions;
      setOptionsError(null);
      touch('platform');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setOptionsError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setOptionsError('The connection options must be a single JSON object.');
      return;
    }
    block.mqttOptions = parsed as Record<string, unknown>;
    setOptionsError(null);
    touch('platform');
    hb().toast.success('Connection options applied to the working copy');
  };

  const test = async () => {
    setTesting(true);
    try {
      await hb().request('/mqtt/test', { url: block.url, username: block.username, password: block.password });
      hb().toast.success(`Connected to ${block.url ?? 'mqtt://localhost:1883'}`, 'MQTT connection OK');
    } catch (e) {
      hb().toast.error(requestErrorMessage(e), 'MQTT connection failed');
    } finally {
      setTesting(false);
    }
  };

  const useSuggestion = () => {
    if (!suggestion) {
      return;
    }
    setOption(block as never, 'url', suggestion.url);
    setOption(block as never, 'username', suggestion.username);
    setOption(block as never, 'password', suggestion.password);
    touch('platform');
  };

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onBack}>
          ← All devices
        </button>
        <h5 class="m-0 mt-1">Platform settings</h5>
        <div class="mqx-desc mt-1">
          These are the defaults for all {counts.platform} platform{' '}
          {counts.platform === 1 ? 'device' : 'devices'}. A device with its own URL, username or password overrides
          them, and devices sharing the same broker settings also share one MQTT connection.
        </div>
      </div>

      <Section title="Identity" defaultOpen>
        <label class="form-label mb-0">Name</label>
        <input
          type="text"
          class="form-control form-control-sm"
          value={typeof block.name === 'string' ? block.name : ''}
          placeholder="MQTT Thing"
          onChange={commit('name')}
        />
        <div class="mqx-desc mt-1">Shown in the Homebridge log and used to name the MQTT client.</div>
      </Section>

      <Section title="Broker defaults" defaultOpen>
        <div class="row g-2 mb-2">
          <div class="col-md-6">
            <label class="form-label mb-0">URL</label>
            <input
              type="text"
              class="form-control form-control-sm mqx-mono"
              value={typeof block.url === 'string' ? block.url : ''}
              placeholder="mqtt://localhost:1883"
              onChange={commit('url')}
            />
          </div>
          <div class="col-md-3">
            <label class="form-label mb-0">Username</label>
            <input
              type="text"
              class="form-control form-control-sm"
              value={typeof block.username === 'string' ? block.username : ''}
              onChange={commit('username')}
            />
          </div>
          <div class="col-md-3">
            <label class="form-label mb-0">Password</label>
            <input
              type="password"
              class="form-control form-control-sm"
              value={typeof block.password === 'string' ? block.password : ''}
              onChange={commit('password')}
            />
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-outline-primary btn-sm" disabled={testing} onClick={test}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {suggestion !== undefined && suggestion.url !== block.url && (
            <button type="button" class="btn btn-link btn-sm p-0" onClick={useSuggestion}>
              Use the most common broker ({suggestion.url})
            </button>
          )}
        </div>
      </Section>

      <Section title="Connection options" summary="mqtt.connect() options as JSON">
        <textarea
          class={`form-control mqx-json-view${optionsError ? ' is-invalid' : ''}`}
          rows={8}
          value={optionsDraft}
          placeholder={'{\n  "keepalive": 10\n}'}
          onInput={(e) => setOptionsDraft((e.currentTarget as HTMLTextAreaElement).value)}
          spellcheck={false}
        />
        {optionsError && <div class="invalid-feedback d-block">{optionsError}</div>}
        <div class="d-flex gap-2 mt-2">
          <button type="button" class="btn btn-outline-primary btn-sm" onClick={applyOptions}>
            Apply options
          </button>
        </div>
        <div class="mqx-desc mt-2">
          Passed straight to mqtt.connect(). A device setting its own options replaces this object rather than merging
          with it. Leave empty to use the defaults.
        </div>
      </Section>
    </div>
  );
}
