// Top-level state container: owns the working copy, the current view and the
// save lifecycle.
//
// Devices live in two containers. The platform block is managed by the
// Homebridge UI itself: every mutation goes through touch('platform'), which
// pushes it to updatePluginConfig() throttled on the leading edge — a
// click-driven change is staged immediately, so the Save button always
// persists it, while typing bursts coalesce into a trailing push at most
// 300 ms later (the block is mutated in place, so a scheduled push always
// sends the latest contents).
//
// Legacy accessory blocks are invisible to that API (the plugin's schema
// declares a platform pluginType), so they are loaded and written through this
// plugin's own server endpoints. To avoid two save buttons where only one is
// complete, the Homebridge UI's Save button is disabled while accessory
// changes are pending, and our own "Save all changes" writes both. A user who
// has already moved everything to platform mode never reaches that state and
// sees no change.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { ThingConfig } from '../../src/config.js';
import { hb, requestErrorMessage } from './homebridge.js';
import {
  configShape,
  containsDevice,
  type DeviceSource,
  type DeviceStore,
  type PlatformBlock,
} from './lib/store-ops.js';
import { PLATFORM_ALIAS } from '../../src/model/identity.js';
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

/** Staging a change: which container it belongs to decides how it is saved. */
export type Touch = (scope: DeviceSource) => void;

const PUSH_DEBOUNCE_MS = 300;
const SAVED_BADGE_MS = 4000;

interface AccessoryResponse {
  blocks: ThingConfig[];
  hash: string | null;
  platform: { present: boolean; devices: number };
}

export function App() {
  // A stable store object: helpers mutate it in place (including creating the
  // platform block on demand), so it must not be rebuilt per render.
  const store = useRef<DeviceStore>({ legacy: [], platform: null }).current;
  const legacyHash = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside a promise callback, where the state value would be stale.
  const ownsSaveNow = useRef(false);

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [legacyUnavailable, setLegacyUnavailable] = useState<string | null>(null);
  const [schemaStale, setSchemaStale] = useState(false);
  const [view, setView] = useState<View>({ name: 'list' });
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [platformDirty, setPlatformDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [, setRevision] = useState(0);

  useEffect(() => {
    (async () => {
      // two independent back-ends (the Homebridge UI's config API and this
      // plugin's own UI server), so both requests are in flight at once
      const platform = hb().getPluginConfig();
      const accessories = hb().request('/config/accessories');
      let given: PlatformBlock | null;
      try {
        const blocks = await platform;
        // the schema is singular, so Homebridge only ever hands back one
        given = Array.isArray(blocks) && blocks.length > 0 ? (blocks[0] as PlatformBlock) : null;
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
        return;
      }
      // A block that is not the platform block means the Homebridge UI is
      // reading a different part of config.json than this plugin declares.
      let stale = given !== null && given.platform !== PLATFORM_ALIAS;
      try {
        const response = (await accessories) as AccessoryResponse;
        store.legacy = Array.isArray(response.blocks) ? response.blocks : [];
        legacyHash.current = response.hash;
        // ... and so does being handed nothing while config.json holds one
        stale ||= given === null && response.platform?.present === true;
      } catch (e) {
        // legacy blocks are optional: platform editing must keep working
        setLegacyUnavailable(requestErrorMessage(e));
      }
      if (stale) {
        setSchemaStale(true);
        setLoaded(true);
        return;
      }
      store.platform = given;
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
  // own button is disabled for exactly as long as it would be incomplete —
  // which is exactly while accessory changes are pending, since its own Save
  // writes the platform block correctly on its own.
  const ownsSave = legacyDirty;
  ownsSaveNow.current = ownsSave;
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
  // Editing from this state would write to the wrong part of config.json, so
  // the screen stops here rather than showing an empty device list.
  if (schemaStale) {
    return (
      <div class="alert alert-warning">
        <p>
          <strong>Restart Homebridge to finish updating this plugin.</strong>
        </p>
        <p class="mb-0">
          The Homebridge UI is still using this plugin&rsquo;s previous configuration schema, so it is looking in the
          wrong part of <span class="mqx-mono">config.json</span> and would report your devices as missing. Nothing has
          been lost and nothing has changed in your configuration — restart Homebridge (or the Homebridge UI service, if
          you run it separately) and reopen this page.
        </p>
      </div>
    );
  }

  const shape = configShape(store);
  const terms = termsFor(shape);
  const legacyAvailable = legacyUnavailable === null;

  const stagedPlatform = () => (store.platform === null ? [] : [store.platform]);

  const pushPlatform = () => {
    hb()
      .updatePluginConfig(stagedPlatform())
      .then(() => {
        // the Homebridge UI re-enables its button when the staged config
        // changes, so the ownership has to be re-asserted
        if (ownsSaveNow.current) {
          hb().disableSaveButton();
        }
      })
      .catch((e) => hb().toast.error(e instanceof Error ? e.message : String(e), 'Failed to stage config changes'));
  };

  const touch: Touch = (scope) => {
    setRevision((r) => r + 1);
    setSaveState({ kind: 'idle' });
    if (scope === 'accessory') {
      setLegacyDirty(true);
      return;
    }
    setPlatformDirty(true);
    if (pushTimer.current === null) {
      pushPlatform();
      pushTimer.current = setTimeout(() => {
        pushTimer.current = null;
        pushPlatform();
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
      // The platform block is written before the accessories are committed.
      // If the second step then fails, a moved device exists in both places
      // and Homebridge keeps using the accessory copy - recoverable. The
      // other order would delete accessories before the platform block holds
      // them, and the devices would disappear from HomeKit.
      //
      // Staging first: savePluginConfig() writes what was last staged, and
      // this also flushes any pending throttled push.
      try {
        await hb().updatePluginConfig(stagedPlatform());
        await hb().savePluginConfig();
        setPlatformDirty(false);
      } catch (e) {
        setSaveState({ kind: 'platform-failed', message: requestErrorMessage(e) });
        window.scrollTo(0, 0);
        return;
      }

      // Never write accessory blocks that could not be read: an empty array
      // would delete every one of them. (The server's hash guard would refuse
      // the write anyway, but failing here says so in plain words.)
      if (legacyAvailable) {
        try {
          const result = (await hb().request('/config/accessories/save', {
            blocks: store.legacy,
            baseHash: legacyHash.current,
          })) as { hash: string };
          legacyHash.current = result.hash;
          setLegacyDirty(false);
        } catch (e) {
          setSaveState({ kind: 'accessories-failed', message: requestErrorMessage(e) });
          window.scrollTo(0, 0);
          return;
        }
      }
      flashSaved();
    } finally {
      hb().hideSpinner();
    }
  };

  const discardPlatformChanges = async () => {
    try {
      const blocks = await hb().getPluginConfig();
      store.platform = Array.isArray(blocks) && blocks.length > 0 ? (blocks[0] as PlatformBlock) : null;
      // re-stage, so the Homebridge UI's own copy matches what is on disk
      await hb().updatePluginConfig(stagedPlatform());
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
          MQTT Thing <span class="text-body-secondary fw-normal">{terms.plural}</span>
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
          legacyUnavailable={legacyUnavailable}
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
          legacyAvailable={legacyAvailable}
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
            touch('accessory');
            touch('platform');
          }}
        />
      )}
    </div>
  );
}
