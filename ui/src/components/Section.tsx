// Collapsible card section used by the editor views. Children are only
// rendered while the section is open (so heavier sections mount lazily).
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

interface Props {
  title: string;
  /** Short summary shown next to the title while the section is closed. */
  summary?: string;
  defaultOpen?: boolean;
  badge?: ComponentChildren;
  children: ComponentChildren;
}

export function Section({ title, summary, defaultOpen, badge, children }: Props) {
  const [open, setOpen] = useState(defaultOpen === true);
  return (
    <div class="card mb-3">
      <div
        class="card-header d-flex align-items-center gap-2"
        role="button"
        onClick={() => setOpen(!open)}
      >
        <span class="text-body-secondary" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span class="fw-semibold">{title}</span>
        {badge}
        {!open && summary && <span class="text-body-secondary text-truncate small ms-auto">{summary}</span>}
      </div>
      {open && <div class="card-body">{children}</div>}
    </div>
  );
}
