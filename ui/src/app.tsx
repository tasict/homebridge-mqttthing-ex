// Top-level state container: owns the working copy, the current view and the
// save lifecycle.
//
// Devices live in two containers. Accessory blocks are managed by the
// Homebridge UI itself: every mutation goes through touch('legacy'), which
// pushes the full array to updatePluginConfig() throttled on the leading edge
// — a click-driven change is staged immediately, so the Save button always
// persists it, while typing bursts coalesce into a trailing push at most
// 300 ms later (the array is mutated in place, so a scheduled push always
// sends the latest contents).
//
// The platform block is invisible to that API (the plugin's schema declares
// an accessory pluginType), so it is loaded and written through this plugin's
// own server endpoints. To avoid two save buttons where only one is complete,
// the Homebridge UI's Save button is disabled while a platform block exists
// with unsaved changes, and our own "Save all changes" writes both. A user
// with only accessory blocks never reaches that state and sees no change.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { ThingConfig } from '../../src/config.js';
import { hb, requestErrorMessage } from './homebridge.js';
import { configShape, containsDevice, type DeviceStore, type PlatformBlock } from './lib/store-ops.js';
import { termsFor } from './lib/terms.js';
import { AddWizard } from './components/AddWizard.js';
import { EditorView } from './components/EditorView.js';
import { ListView } from './components/ListView.js';
import { MigrationView } from './components/MigrationView.js';
import { PlatformIntroView } from './components/PlatformIntroView.js';
import { PlatformSettingsView } from './components/PlatformSettingsView.js';
import { SaveBadge, SaveError, type SaveState } from './components/SaveBar.js';

export type View =
  | { name: 'list' }
  | { name: 'edit'; device: ThingConfig }
  | { name: 'add' }
  | { name: 'platform-settings' }
  | { name: 'platform-intro' }
  | { name: 'migrate' };

/** Which container a change belongs to; decides how it is staged. */
export type TouchScope = 'legacy' | 'platform';
export type Touch = (scope: TouchScope) => void;

const PUSH_DEBOUNCE_MS = 300;
const SAVED_BADGE_MS = 4000;

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
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [platformUnavailable, setPlatformUnavailable] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'list' });
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [platformDirty, setPlatformDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
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
        // platform mode is optional: accessory editing must keep working
        setPlatformUnavailable(requestErrorMessage(e));
      }
      setLoaded(true);
    })();
    return () => {
      for (const timer of [pushTimer, savedTimer]) {
        if (timer.current !== null) {
          clearTimeout(timer.current);
        }
      }
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    hb().fixScrollHeight();
  }, [view]);

  // Saving both containers is only possible from here, so the Homebridge UI's
  // own button is disabled for exactly as long as it would be incomplete.
  const ownsSave = store.platform !== null && (legacyDirty || platformDirty);
  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (ownsSave) {
      hb().disableSaveButton();
    } else {
      hb().enableSaveButton();
    }
  }, [loaded, ownsSave]);

  if (loadError !== null) {
    return <div class="alert alert-danger">Failed to load the plugin configuration: {loadError}</div>;
  }
  if (!loaded) {
    return <div class="text-center my-4">Loading configuration&hellip;</div>;
  }

  const shape = configShape(store);
  const terms = termsFor(shape);
  const platformAvailable = platformUnavailable === null;

  const pushLegacy = () => {
    hb()
      .updatePluginConfig(store.legacy)
      .then(() => {
        // the Homebridge UI re-enables its button when the staged config
        // changes, so the ownership has to be re-asserted
        if (store.platform !== null) {
          hb().disableSaveButton();
        }
      })
      .catch((e) => hb().toast.error(e instanceof Error ? e.message : String(e), 'Failed to stage config changes'));
  };

  const touch: Touch = (scope) => {
    setRevision((r) => r + 1);
    setSaveState({ kind: 'idle' });
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

  const flashSaved = () => {
    setSaveState({ kind: 'saved' });
    if (savedTimer.current !== null) {
      clearTimeout(savedTimer.current);
    }
    savedTimer.current = setTimeout(() => {
      savedTimer.current = null;
      setSaveState({ kind: 'idle' });
    }, SAVED_BADGE_MS);
  };

  const saveAll = async () => {
    setSaveState({ kind: 'saving' });
    hb().showSpinner();
    try {
      // Stage the accessory array first: savePluginConfig() writes what was
      // last staged, and this also flushes any pending throttled push.
      await hb().updatePluginConfig(store.legacy);

      // The platform block is written before the accessories are committed.
      // If the second step then fails, a moved device exists in both places
      // and Homebridge keeps using the accessory copy - recoverable. The
      // other order would delete accessories before the platform block holds
      // them, and the devices would disappear from HomeKit.
      if (store.platform !== null) {
        try {
          const result = (await hb().request('/config/platform/save', {
            block: store.platform,
            baseHash: platformHash.current,
          })) as { hash: string };
          platformHash.current = result.hash;
          setPlatformDirty(false);
        } catch (e) {
          setSaveState({ kind: 'platform-failed', message: requestErrorMessage(e) });
          window.scrollTo(0, 0);
          return;
        }
      }

      try {
        await hb().savePluginConfig();
      } catch (e) {
        setSaveState({ kind: 'accessories-failed', message: requestErrorMessage(e) });
        window.scrollTo(0, 0);
        return;
      }
      setLegacyDirty(false);
      flashSaved();
    } finally {
      hb().hideSpinner();
    }
  };

  const discardPlatformChanges = async () => {
    try {
      const response = (await hb().request('/config/platform')) as PlatformResponse;
      store.platform = response.block;
      platformHash.current = response.hash;
      setPlatformDirty(false);
      setSaveState({ kind: 'idle' });
      setRevision((r) => r + 1);
      setView({ name: 'list' });
    } catch (e) {
      hb().toast.error(requestErrorMessage(e), 'Could not reload the platform configuration');
    }
  };

  const copyChangesAsJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(store.platform, null, 2));
      hb().toast.success('Platform configuration copied to the clipboard');
    } catch {
      hb().toast.error('Could not access the clipboard');
    }
  };

  const openDevice = (device: ThingConfig) => setView({ name: 'edit', device });

  return (
    <div>
      <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
        <h5 class="m-0">
          MQTT Thing <span class="text-body-secondary fw-normal">{terms.headerNoun}</span>
        </h5>
        <div class="d-flex align-items-center gap-2">
          <SaveBadge
            ownsSave={ownsSave}
            dirty={legacyDirty || platformDirty}
            state={saveState}
            onSave={() => void saveAll()}
          />
        </div>
      </div>

      <SaveError
        state={saveState}
        onSave={() => void saveAll()}
        onDiscardPlatform={() => void discardPlatformChanges()}
        onCopyJson={() => void copyChangesAsJson()}
      />

      {view.name === 'list' && (
        <ListView
          store={store}
          platformAvailable={platformAvailable}
          platformUnavailable={platformUnavailable}
          onEdit={openDevice}
          onAdd={() => setView({ name: 'add' })}
          onPlatformSettings={() => setView({ name: 'platform-settings' })}
          onPlatformIntro={() => setView({ name: 'platform-intro' })}
          onMigrate={() => setView({ name: 'migrate' })}
        />
      )}
      {view.name === 'edit' && containsDevice(store, view.device) && (
        <EditorView
          config={view.device}
          store={store}
          platformAvailable={platformAvailable}
          touch={touch}
          onBack={() => setView({ name: 'list' })}
          onOpen={openDevice}
        />
      )}
      {view.name === 'edit' && !containsDevice(store, view.device) && (
        <div class="alert alert-warning">
          This {terms.singular} no longer exists.{' '}
          <button class="btn btn-sm btn-outline-secondary" onClick={() => setView({ name: 'list' })}>
            Back to the list
          </button>
        </div>
      )}
      {view.name === 'add' && (
        <AddWizard
          store={store}
          platformAvailable={platformAvailable}
          touch={touch}
          onCancel={() => setView({ name: 'list' })}
          onCreated={openDevice}
          onPlatformIntro={() => setView({ name: 'platform-intro' })}
        />
      )}
      {view.name === 'platform-settings' && store.platform !== null && (
        <PlatformSettingsView
          store={store}
          block={store.platform}
          touch={touch}
          onBack={() => setView({ name: 'list' })}
        />
      )}
      {view.name === 'platform-intro' && (
        <PlatformIntroView
          store={store}
          onBack={() => setView({ name: 'list' })}
          onMigrate={() => setView({ name: 'migrate' })}
        />
      )}
      {view.name === 'migrate' && (
        <MigrationView
          store={store}
          onBack={() => setView({ name: 'list' })}
          onMigrated={() => {
            touch('legacy');
            touch('platform');
          }}
        />
      )}
    </div>
  );
}
