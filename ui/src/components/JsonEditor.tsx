// Per-accessory "Edit as JSON" escape hatch. Applying replaces the CONTENTS
// of the existing config object (keeping its identity), so the working-copy
// array itself is never rebuilt.
import { useState } from 'preact/hooks';

import type { ThingConfig } from '../../../src/config.js';
import { hb } from '../homebridge.js';
import { parseAccessoryJson, replaceConfigContents } from '../lib/config-ops.js';

interface Props {
  config: ThingConfig;
  touch: () => void;
}

export function JsonEditor({ config, touch }: Props) {
  const [draft, setDraft] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const result = parseAccessoryJson(draft);
    if (result.error !== undefined) {
      setError(result.error);
      hb().toast.error(result.error, 'JSON not applied');
      return;
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
