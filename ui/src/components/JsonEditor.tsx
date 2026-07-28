// Per-device "Edit as JSON" escape hatch. Applying replaces the CONTENTS of
// the existing config object (keeping its identity), so the working-copy
// array itself is never rebuilt.
//
// For a platform device the id is protected: omitting it keeps the current
// one, and changing it has to be confirmed because HomeKit would see a
// different accessory.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { hb } from '../homebridge.js';
import { parseAccessoryJson, parsePlatformDeviceJson, replaceConfigContents } from '../lib/config-ops.js';
import type { DeviceSource } from '../lib/store-ops.js';

interface Props {
  config: ThingConfig;
  source: DeviceSource;
  touch: () => void;
}

export function JsonEditor({ config, source, touch }: Props) {
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const currentId = typeof config.id === 'string' ? config.id : undefined;
    const result =
      source === 'platform' ? parsePlatformDeviceJson(draft, currentId) : parseAccessoryJson(draft);
    if (result.error !== undefined) {
      setError(result.error);
      hb().toast.error(result.error, 'JSON not applied');
      return;
    }
    if (source === 'platform' && 'idChanged' in result && result.idChanged) {
      const confirmed = window.confirm(
        `Changing the device id makes HomeKit treat this as a brand-new accessory - its room assignment, ` +
          `scenes and automations will be lost.\n\nKeep the new id "${String(result.config.id)}"?`,
      );
      if (!confirmed) {
        result.config.id = currentId;
      }
    }
    replaceConfigContents(config, result.config);
    setDraft(JSON.stringify(config, null, 2));
    setError(null);
    touch();
    hb().toast.success('JSON applied to the working copy');
  };

  return (
    <div>
      <textarea
        class={`form-control mqx-json-view${error ? ' is-invalid' : ''}`}
        rows={14}
        value={draft}
        onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
        spellcheck={false}
      />
      {error && <div class="invalid-feedback d-block">{error}</div>}
      <div class="d-flex gap-2 mt-2">
        <button type="button" class="btn btn-outline-primary btn-sm" onClick={apply}>
          Apply JSON
        </button>
        <button
          type="button"
          class="btn btn-outline-secondary btn-sm"
          onClick={() => {
            setDraft(JSON.stringify(config, null, 2));
            setError(null);
          }}
        >
          Reload from working copy
        </button>
      </div>
    </div>
  );
}
