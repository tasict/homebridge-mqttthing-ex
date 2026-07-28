// Per-device "Edit as JSON" escape hatch. Applying replaces the CONTENTS of
// the existing config object (keeping its identity), so the working-copy
// array itself is never rebuilt.
//
// For a platform device the id is protected: omitting it keeps the current
// one, and changing it has to be confirmed in the page (this UI runs in a
// sandboxed iframe where native dialogs never appear) because HomeKit would
// see a different accessory.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { hb } from '../homebridge.js';
import { parseAccessoryJson, parsePlatformDeviceJson, replaceConfigContents } from '../lib/config-ops.js';
import type { DeviceSource } from '../lib/store-ops.js';
import { ConfirmPanel } from './ConfirmAction.js';

interface Props {
  config: ThingConfig;
  source: DeviceSource;
  touch: () => void;
}

export function JsonEditor({ config, source, touch }: Props) {
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [pendingIdChange, setPendingIdChange] = useState<Record<string, unknown> | null>(null);

  const commit = (replacement: Record<string, unknown>) => {
    replaceConfigContents(config, replacement);
    setDraft(JSON.stringify(config, null, 2));
    setError(null);
    setPendingIdChange(null);
    touch();
    hb().toast.success('JSON applied to the working copy');
  };

  const apply = () => {
    const currentId = typeof config.id === 'string' ? config.id : undefined;
    const result = source === 'platform' ? parsePlatformDeviceJson(draft, currentId) : parseAccessoryJson(draft);
    if (result.error !== undefined) {
      setError(result.error);
      hb().toast.error(result.error, 'JSON not applied');
      return;
    }
    if (source === 'platform' && 'idChanged' in result && result.idChanged) {
      setPendingIdChange(result.config);
      setError(null);
      return;
    }
    commit(result.config);
  };

  const keepCurrentId = () => {
    const replacement = pendingIdChange;
    if (!replacement) {
      return;
    }
    const currentId = typeof config.id === 'string' ? config.id : undefined;
    if (currentId === undefined) {
      delete replacement.id;
    } else {
      replacement.id = currentId;
    }
    commit(replacement);
  };

  return (
    <div>
      {pendingIdChange !== null && (
        <ConfirmPanel
          title="This changes the device id"
          confirmLabel="Change the id anyway"
          variant="danger"
          onConfirm={() => commit(pendingIdChange)}
          onCancel={keepCurrentId}
        >
          HomeKit identifies this device by its id. Changing it from{' '}
          <span class="mqx-mono">{String(config.id ?? '')}</span> to{' '}
          <span class="mqx-mono">{String(pendingIdChange.id ?? '')}</span> makes it a brand-new accessory: its room,
          scenes and automations are lost. Cancel to apply the rest of your changes and keep the current id.
        </ConfirmPanel>
      )}
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
            setPendingIdChange(null);
          }}
        >
          Reload from working copy
        </button>
      </div>
    </div>
  );
}
