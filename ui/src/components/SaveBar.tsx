// The save affordance in the page header, plus the failure rows below it.
//
// Accessory blocks are saved by the Homebridge UI's own Save button at the
// bottom of the window; the platform block is written by this plugin's
// server. Rather than explaining that, the UI takes ownership: as soon as a
// platform block exists and something is unsaved, the native button is
// disabled and this one saves both. A user with only accessory blocks never
// sees this control at all - their Save button keeps working exactly as it
// always did.
import { ConfirmButton } from './ConfirmAction.js';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'platform-failed'; message: string }
  | { kind: 'accessories-failed'; message: string };

interface Props {
  /** True while this page owns saving, i.e. platform changes are pending. */
  ownsSave: boolean;
  dirty: boolean;
  state: SaveState;
  onSave: () => void;
  onDiscardPlatform: () => void;
  onCopyJson: () => void;
}

/** The header's right-hand cluster: status badge and, when we own it, Save. */
export function SaveBadge({ ownsSave, dirty, state, onSave }: Omit<Props, 'onDiscardPlatform' | 'onCopyJson'>) {
  if (state.kind === 'saved') {
    return <span class="badge text-bg-success">Saved — restart Homebridge to apply</span>;
  }
  if (!dirty) {
    return null;
  }
  if (!ownsSave) {
    return (
      <span class="badge text-bg-warning" title="Changes are staged; nothing is written until you save.">
        Unsaved changes — click Save below
      </span>
    );
  }
  return (
    <>
      <span class="badge text-bg-warning">Unsaved changes</span>
      <button class="btn btn-primary btn-sm" disabled={state.kind === 'saving'} onClick={onSave}>
        {state.kind === 'saving' ? 'Saving…' : 'Save all changes'}
      </button>
    </>
  );
}

/** Failure explanations, shown in place instead of a toast that vanishes. */
export function SaveError({ state, onSave, onDiscardPlatform, onCopyJson }: Omit<Props, 'ownsSave' | 'dirty'>) {
  if (state.kind === 'platform-failed') {
    return (
      <div class="alert alert-danger py-2">
        <div class="mb-2">
          <strong>Nothing was saved.</strong> The platform block could not be written: {state.message}
        </div>
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm btn-primary" onClick={onSave}>
            Try again
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCopyJson}>
            Copy my changes as JSON
          </button>
          <ConfirmButton
            label="Discard my platform changes"
            confirmLabel="Confirm discard?"
            className="btn-sm"
            onConfirm={onDiscardPlatform}
          />
        </div>
      </div>
    );
  }
  if (state.kind === 'accessories-failed') {
    return (
      <div class="alert alert-warning py-2">
        <div class="mb-2">
          The platform block was saved, but the accessory blocks were not: {state.message} Until this succeeds,
          anything you moved still exists as an accessory as well, and Homebridge keeps using those — nothing is lost.
        </div>
        <button type="button" class="btn btn-sm btn-primary" onClick={onSave}>
          Try again
        </button>
      </div>
    );
  }
  return null;
}
