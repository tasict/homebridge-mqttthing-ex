// Top-level state container: owns the working copy (the actual config
// objects returned by getPluginConfig), the current view and the save
// lifecycle. Every mutation goes through touch(), which re-renders and
// pushes the full array to updatePluginConfig() after a 300 ms debounce;
// the native Save button of config-ui-x always persists the latest pushed
// state. savePluginConfig() is never called automatically.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { ThingConfig } from '../../src/config.js';
import { hb } from './homebridge.js';
import { AddWizard } from './components/AddWizard.js';
import { EditorView } from './components/EditorView.js';
import { ListView } from './components/ListView.js';

export type View =
  | { name: 'list' }
  | { name: 'edit'; index: number }
  | { name: 'add' };

const PUSH_DEBOUNCE_MS = 300;

export function App() {
  const [configs, setConfigs] = useState<ThingConfig[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'list' });
  const [dirty, setDirty] = useState(false);
  const [, setRevision] = useState(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const blocks = await hb().getPluginConfig();
        setConfigs(Array.isArray(blocks) ? (blocks as ThingConfig[]) : []);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      if (pushTimer.current !== null) {
        clearTimeout(pushTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    hb().fixScrollHeight();
  }, [view]);

  if (loadError !== null) {
    return <div class="alert alert-danger">Failed to load the plugin configuration: {loadError}</div>;
  }
  if (configs === null) {
    return <div class="text-center my-4">Loading configuration&hellip;</div>;
  }

  const touch = () => {
    setDirty(true);
    setRevision((r) => r + 1);
    if (pushTimer.current !== null) {
      clearTimeout(pushTimer.current);
    }
    pushTimer.current = setTimeout(() => {
      pushTimer.current = null;
      hb()
        .updatePluginConfig(configs)
        .catch((e) => hb().toast.error(e instanceof Error ? e.message : String(e), 'Failed to stage config changes'));
    }, PUSH_DEBOUNCE_MS);
  };

  return (
    <div>
      <div class="d-flex align-items-center justify-content-between mb-3">
        <h5 class="m-0">
          MQTT Thing <span class="text-body-secondary fw-normal">accessories</span>
        </h5>
        {dirty && (
          <span class="badge text-bg-warning" title="Changes are staged; nothing is written until you save.">
            Unsaved changes &mdash; click Save below
          </span>
        )}
      </div>

      {view.name === 'list' && (
        <ListView
          configs={configs}
          onEdit={(index) => setView({ name: 'edit', index })}
          onAdd={() => setView({ name: 'add' })}
        />
      )}
      {view.name === 'edit' && view.index >= 0 && view.index < configs.length && (
        <EditorView
          config={configs[view.index]}
          configs={configs}
          touch={touch}
          onBack={() => setView({ name: 'list' })}
          onOpen={(index) => setView({ name: 'edit', index })}
        />
      )}
      {view.name === 'edit' && (view.index < 0 || view.index >= configs.length) && (
        <div class="alert alert-warning">
          This accessory no longer exists.{' '}
          <button class="btn btn-sm btn-outline-secondary" onClick={() => setView({ name: 'list' })}>
            Back to the list
          </button>
        </div>
      )}
      {view.name === 'add' && (
        <AddWizard
          configs={configs}
          touch={touch}
          onCancel={() => setView({ name: 'list' })}
          onCreated={(index) => setView({ name: 'edit', index })}
        />
      )}
    </div>
  );
}
