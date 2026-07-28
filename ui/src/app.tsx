// Top-level state container: owns the working copy, the current view and the
// save lifecycle.
//
// Devices live in two containers. Legacy accessories[] blocks are managed by
// homebridge-config-ui-x itself: every mutation goes through touch('legacy'),
// which pushes the full array to updatePluginConfig() throttled on the
// leading edge — a click-driven change is staged immediately, so the native
// Save button always persists it, while typing bursts coalesce into a
// trailing push at most 300 ms later (the array is mutated in place, so a
// scheduled push always sends the latest contents).
//
// The platform block is invisible to that API (the plugin's schema declares
// an accessory pluginType), so it is loaded and written through this plugin's
// own server endpoints. Platform edits are staged in memory only and written
// by the explicit "Save changes" button, which saves both containers.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { ThingConfig } from '../../src/config.js';
import { hb, requestErrorMessage } from './homebridge.js';
import { containsDevice, type DeviceStore, type PlatformBlock } from './lib/store-ops.js';
import { AddWizard } from './components/AddWizard.js';
import { EditorView } from './components/EditorView.js';
import { ListView } from './components/ListView.js';
import { PlatformSettingsView } from './components/PlatformSettingsView.js';

export type View =
  | { name: 'list' }
  | { name: 'edit'; device: ThingConfig }
  | { name: 'add' }
  | { name: 'platform-settings' };

/** Which container a change belongs to; decides how it is staged. */
export type TouchScope = 'legacy' | 'platform';
export type Touch = (scope: TouchScope) => void;

const PUSH_DEBOUNCE_MS = 300;

interface PlatformResponse {
  exists: boolean;
  block: PlatformBlock | null;
  hash: string | null;
}

export function App() {
  // A stable store object: helpers mutate it in place (including creating the
  // platform block on demand), so it must not be rebuilt per render.
  const store = useRef<DeviceStore>({ legacy: [], platform: null }).current;
  const platformHash = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [platformUnavailable, setPlatformUnavailable] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'list' });
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [platformDirty, setPlatformDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, setRevision] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const blocks = await hb().getPluginConfig();
        store.legacy = Array.isArray(blocks) ? (blocks as ThingConfig[]) : [];
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
        return;
      }
      try {
        const response = (await hb().request('/config/platform')) as PlatformResponse;
        store.platform = response.block;
        platformHash.current = response.hash;
      } catch (e) {
        // platform mode is optional: legacy editing must keep working
        setPlatformUnavailable(requestErrorMessage(e));
      }
      setLoaded(true);
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
  if (!loaded) {
    return <div class="text-center my-4">Loading configuration&hellip;</div>;
  }

  const pushLegacy = () => {
    hb()
      .updatePluginConfig(store.legacy)
      .catch((e) => hb().toast.error(e instanceof Error ? e.message : String(e), 'Failed to stage config changes'));
  };

  const touch: Touch = (scope) => {
    setRevision((r) => r + 1);
    if (scope === 'platform') {
      setPlatformDirty(true);
      return;
    }
    setLegacyDirty(true);
    if (pushTimer.current === null) {
      pushLegacy();
      pushTimer.current = setTimeout(() => {
        pushTimer.current = null;
        pushLegacy();
      }, PUSH_DEBOUNCE_MS);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      // stage the legacy array first: savePluginConfig() writes what was
      // last staged, and this also flushes any pending throttled push
      await hb().updatePluginConfig(store.legacy);

      const result = (await hb().request('/config/platform/save', {
        block: store.platform,
        baseHash: platformHash.current,
      })) as { hash: string };
      platformHash.current = result.hash;
      setPlatformDirty(false);

      try {
        await hb().savePluginConfig();
      } catch (e) {
        hb().toast.error(
          `Platform devices were saved, but saving the legacy accessories failed: ${requestErrorMessage(e)}. ` +
            'Use the Save button at the bottom of this window to retry.',
        );
        return;
      }
      setLegacyDirty(false);
      hb().toast.success('Configuration saved. Restart Homebridge to apply the changes.');
    } catch (e) {
      hb().toast.error(requestErrorMessage(e), 'Could not save the platform configuration');
    } finally {
      setSaving(false);
    }
  };

  const dirty = legacyDirty || platformDirty;
  const openDevice = (device: ThingConfig) => setView({ name: 'edit', device });

  return (
    <div>
      <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
        <h5 class="m-0">
          MQTT Thing <span class="text-body-secondary fw-normal">devices</span>
        </h5>
        <div class="d-flex align-items-center gap-2">
          {dirty && (
            <span
              class="badge text-bg-warning"
              title={
                platformDirty
                  ? 'The Save button at the bottom of this window only saves legacy accessories. Use Save changes here to save everything, including platform devices.'
                  : 'Changes are staged; nothing is written until you save.'
              }
            >
              {platformDirty ? 'Unsaved changes — click Save changes' : 'Unsaved changes — click Save below'}
            </span>
          )}
          {platformDirty && (
            <button class="btn btn-primary btn-sm" disabled={saving} onClick={saveAll}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>

      {platformUnavailable !== null && (
        <div class="alert alert-warning">
          Platform mode is unavailable: {platformUnavailable} Legacy accessories can still be edited.
        </div>
      )}

      {view.name === 'list' && (
        <ListView
          store={store}
          platformAvailable={platformUnavailable === null}
          onEdit={openDevice}
          onAdd={() => setView({ name: 'add' })}
          onPlatformSettings={() => setView({ name: 'platform-settings' })}
          touch={touch}
        />
      )}
      {view.name === 'edit' && containsDevice(store, view.device) && (
        <EditorView
          config={view.device}
          store={store}
          platformAvailable={platformUnavailable === null}
          touch={touch}
          onBack={() => setView({ name: 'list' })}
          onOpen={openDevice}
        />
      )}
      {view.name === 'edit' && !containsDevice(store, view.device) && (
        <div class="alert alert-warning">
          This device no longer exists.{' '}
          <button class="btn btn-sm btn-outline-secondary" onClick={() => setView({ name: 'list' })}>
            Back to the list
          </button>
        </div>
      )}
      {view.name === 'add' && (
        <AddWizard
          store={store}
          platformAvailable={platformUnavailable === null}
          touch={touch}
          onCancel={() => setView({ name: 'list' })}
          onCreated={openDevice}
        />
      )}
      {view.name === 'platform-settings' && (
        <PlatformSettingsView store={store} touch={touch} onBack={() => setView({ name: 'list' })} />
      )}
    </div>
  );
}
