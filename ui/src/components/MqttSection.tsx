// MQTT connection card: broker url/username/password, a connection test
// through the server (/mqtt/test) and a batch "apply to all" action.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { hb, requestErrorMessage } from '../homebridge.js';
import { setOption } from '../lib/config-ops.js';

interface Props {
  config: ThingConfig;
  configs: ThingConfig[];
  touch: () => void;
}

export function MqttSection({ config, configs, touch }: Props) {
  const [testing, setTesting] = useState(false);

  const commit = (key: 'url' | 'username' | 'password') => (e: Event) => {
    setOption(config, key, (e.currentTarget as HTMLInputElement).value.trim() || undefined);
    touch();
  };

  const test = async () => {
    setTesting(true);
    try {
      await hb().request('/mqtt/test', {
        url: config.url,
        username: config.username,
        password: config.password,
      });
      hb().toast.success(`Connected to ${config.url ?? 'mqtt://localhost:1883'}`, 'MQTT connection OK');
    } catch (e) {
      hb().toast.error(requestErrorMessage(e), 'MQTT connection failed');
    } finally {
      setTesting(false);
    }
  };

  const applyToAll = () => {
    const others = configs.length - 1;
    if (others < 1) {
      return;
    }
    if (!window.confirm(`Apply this broker (URL, username, password) to all ${configs.length} accessories?`)) {
      return;
    }
    for (const other of configs) {
      if (other !== config) {
        setOption(other, 'url', config.url);
        setOption(other, 'username', config.username);
        setOption(other, 'password', config.password);
      }
    }
    touch();
    hb().toast.success(`Broker settings copied to ${others} other ${others === 1 ? 'accessory' : 'accessories'}`);
  };

  return (
    <div>
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label mb-0">URL</label>
          <input
            type="text"
            class="form-control form-control-sm mqx-mono"
            value={typeof config.url === 'string' ? config.url : ''}
            placeholder="mqtt://localhost:1883"
            onChange={commit('url')}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label mb-0">Username</label>
          <input
            type="text"
            class="form-control form-control-sm"
            value={typeof config.username === 'string' ? config.username : ''}
            onChange={commit('username')}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label mb-0">Password</label>
          <input
            type="password"
            class="form-control form-control-sm"
            value={typeof config.password === 'string' ? config.password : ''}
            onChange={commit('password')}
          />
        </div>
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-outline-primary btn-sm" disabled={testing} onClick={test}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {configs.length > 1 && (
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick={applyToAll}>
            Apply to all accessories
          </button>
        )}
      </div>
      <div class="mqx-desc mt-2">
        Leave the URL empty to use mqtt://localhost:1883. The environment variables MQTTTHING_URL / MQTTTHING_USERNAME /
        MQTTTHING_PASSWORD also work as defaults at runtime.
      </div>
    </div>
  );
}
