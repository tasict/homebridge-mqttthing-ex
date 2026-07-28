// Inline confirmation for actions that need explaining before they happen.
//
// The Homebridge UI embeds this page in a sandboxed iframe without
// "allow-modals", so window.confirm() shows nothing and returns false - the
// action would appear to do nothing at all. Confirmation therefore has to
// happen in the page itself.
//
// Two shapes are provided: a button that arms itself on the first click (for
// short, obvious actions), and a panel that explains what is about to happen
// (for anything the user should read first).
import type { ComponentChildren } from 'preact';

import { useArmed } from '../lib/use-armed.js';

interface ConfirmButtonProps {
  /** Label in the resting state. */
  label: string;
  /** Label once armed, e.g. "Confirm delete?". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Bootstrap button class of the resting state. */
  variant?: string;
  /** Bootstrap button class once armed. */
  confirmVariant?: string;
  className?: string;
  title?: string;
  /** Milliseconds before the armed state relaxes again. */
  timeoutMs?: number;
}

/** Two-click button: the first click arms it, the second acts. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  variant = 'btn-outline-danger',
  confirmVariant = 'btn-danger',
  className = '',
  title,
  timeoutMs = 4000,
}: ConfirmButtonProps) {
  const { armed, arm, reset } = useArmed(timeoutMs);

  const click = () => {
    if (!armed) {
      arm();
      return;
    }
    reset();
    onConfirm();
  };

  return (
    <button
      type="button"
      class={`btn ${armed ? confirmVariant : variant} ${className}`.trim()}
      title={title}
      onClick={click}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

interface ConfirmPanelProps {
  title: string;
  children: ComponentChildren;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'primary' | 'danger';
}

/** In-page confirmation with room to explain the consequences. */
export function ConfirmPanel({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  variant = 'primary',
}: ConfirmPanelProps) {
  return (
    <div class={`alert alert-${variant === 'danger' ? 'danger' : 'secondary'} mqx-confirm`}>
      <div class="fw-semibold mb-1">{title}</div>
      <div class="mb-2">{children}</div>
      <div class="d-flex gap-2">
        <button type="button" class={`btn btn-sm btn-${variant}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
