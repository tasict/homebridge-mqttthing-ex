// MQTT connection card: broker url/username/password, a connection test
// through the server (/mqtt/test) and a batch "apply to all" action.
//
// A platform device may leave these empty to inherit the platform defaults,
// so the fields show what the device actually connects to.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { hb, requestErrorMessage } from '../homebridge.js';
import { setOption } from '../lib/config-ops.js';
import {
  applyBrokerToAllDevices,
  deviceCounts,
  effectiveBroker,
  sourceOf,
  type DeviceStore,
} from '../lib/store-ops.js';
import type { Touch } from '../app.js';

interface Props {
  config: ThingConfig;
  store: DeviceStore;
  touch: Touch;
}

export function MqttSection({ config, store, touch }: Props) {
  const [testing, setTesting] = useState(false);

  const source = sourceOf(store, config);
  const broker = effectiveBroker(store, config);
  const counts = deviceCounts(store);
  const platformDefaults = source === 'platform' ? store.platform : null;
  const inheritedUrl =
    typeof platformDefaults?.url === 'string' && platformDefaults.url !== '' ? platformDefaults.url : undefined;

  const commit = (key: 'url' | 'username' | 'password') => (e: Event) => {
    setOption(config, key, (e.currentTarget as HTMLInputElement).value.trim() || undefined);
    touch(source === 'platform' ? 'platform' : 'legacy');
  };

  const test = async () => {
    setTesting(true);
    try {
      await hb().request('/mqtt/test', broker);
      hb().toast.success(`Connected to ${broker.url ?? 'mqtt://localhost:1883'}`, 'MQTT connection OK');
    } catch (e) {
      hb().toast.error(requestErrorMessage(e), 'MQTT connection failed');
    } finally {
      setTesting(false);
    }
  };

  const applyToAll = () => {
    const others = counts.total - 1;
    if (others < 1) {
      return;
    }
    if (
      !window.confirm(
        `Apply this broker (URL, username, password) to all ${counts.total} devices, legacy and platform?\n\n` +
          'The platform default settings are not changed.',
      )
    ) {
      return;
    }
    applyBrokerToAllDevices(store, config);
    if (counts.legacy > 0) {
      touch('legacy');
    }
    if (counts.platform > 0) {
      touch('platform');
    }
    hb().toast.success(`Broker settings copied to ${others} other ${others === 1 ? 'device' : 'devices'}`);
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
            placeholder={inheritedUrl ?? 'mqtt://localhost:1883'}
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
        {counts.total > 1 && (
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick={applyToAll}>
            Apply to all devices
          </button>
        )}
      </div>
      <div class="mqx-desc mt-2">
        {source === 'platform' ? (
          <>
            Leave these empty to use the platform broker
            {inheritedUrl !== undefined ? ` (${inheritedUrl})` : ''}. Setting a value here overrides it for this device
            only, which also gives the device its own MQTT connection.
          </>
        ) : (
          <>
            Leave the URL empty to use mqtt://localhost:1883. The environment variables MQTTTHING_URL /
            MQTTTHING_USERNAME / MQTTTHING_PASSWORD also work as defaults at runtime.
          </>
        )}
      </div>
    </div>
  );
}
