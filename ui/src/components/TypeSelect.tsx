// Searchable accessory-type picker, grouped by model category. Lists every
// base type plus the UI-only lightbulb subtype aliases.
import { useMemo, useState } from 'preact/hooks';

import type { AccessoryCategory } from '../../../src/model/model-types.js';
import { ACCESSORY_TYPES, getTypeModel } from '../../../src/model/types.js';

interface TypeItem {
  id: string;
  label: string;
  category: AccessoryCategory;
}

function allTypeItems(excludeCustom: boolean): TypeItem[] {
  const items: TypeItem[] = [];
  for (const type of ACCESSORY_TYPES) {
    if (excludeCustom && type.id === 'custom') {
      continue;
    }
    items.push({ id: type.id, label: type.label, category: type.category });
    for (const alias of type.subtypeAliases ?? []) {
      items.push({ id: alias, label: `${type.label} – ${alias}`, category: type.category });
    }
  }
  return items;
}

interface Props {
  value: string | undefined;
  onSelect: (id: string) => void;
  excludeCustom?: boolean;
}

export function TypeSelect({ value, onSelect, excludeCustom }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const items = useMemo(() => allTypeItems(excludeCustom === true), [excludeCustom]);

  const model = getTypeModel(value);
  const currentLabel = model
    ? model.id === value
      ? model.label
      : `${model.label} (${value})`
    : value
      ? `${value} (unknown type)`
      : 'Select a type…';

  const q = query.trim().toLowerCase();
  const filtered = q === '' ? items : items.filter((i) => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  const categories: AccessoryCategory[] = [];
  for (const item of filtered) {
    if (!categories.includes(item.category)) {
      categories.push(item.category);
    }
  }

  const pick = (id: string) => {
    setOpen(false);
    setQuery('');
    onSelect(id);
  };

  return (
    <div class="mqx-type-select">
      <button
        type="button"
        class={`form-select text-start${model ? '' : ' text-body-secondary'}`}
        onClick={() => setOpen(!open)}
      >
        {currentLabel}
      </button>
      {open && (
        <>
          <div class="mqx-backdrop" onClick={() => setOpen(false)} />
          <div class="mqx-type-menu card">
            <div class="p-2">
              <input
                type="text"
                class="form-control form-control-sm"
                placeholder="Search types&hellip;"
                value={query}
                onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
                autoFocus
              />
            </div>
            {categories.map((category) => (
              <div key={category}>
                <div class="mqx-type-category">{category}</div>
                <div class="list-group list-group-flush">
                  {filtered
                    .filter((i) => i.category === category)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        class={`list-group-item list-group-item-action${item.id === value ? ' fw-bold' : ''}`}
                        onClick={() => pick(item.id)}
                      >
                        {item.label} <span class="mqx-key mqx-mono">{item.id}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div class="p-2 text-body-secondary small">No matching types.</div>}
          </div>
        </>
      )}
    </div>
  );
}
