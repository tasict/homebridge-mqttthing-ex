// The noun the UI uses for a configured thing.
//
// It follows the configuration the user actually has: someone using only
// accessory blocks keeps reading "accessory", exactly as before platform mode
// existed. The word only changes once they adopt platform mode, at which
// point "device" matches the `devices` key they can see in their own config.
//
// "Legacy" is deliberately absent: accessory mode is frozen and permanently
// supported, and calling it legacy would push users towards a change they
// have no reason to make.
import type { ConfigShape } from './store-ops.js';

export interface Terms {
  singular: string;
  plural: string;
  /** Capitalised singular, for headings and badges. */
  Singular: string;
  addLabel: string;
  backLabel: string;
  headerNoun: string;
}

export const ACCESSORY_TERMS: Terms = {
  singular: 'accessory',
  plural: 'accessories',
  Singular: 'Accessory',
  addLabel: '+ Add accessory',
  backLabel: '← All accessories',
  headerNoun: 'accessories',
};

export const DEVICE_TERMS: Terms = {
  singular: 'device',
  plural: 'devices',
  Singular: 'Device',
  addLabel: '+ Add device',
  backLabel: '← All devices',
  headerNoun: 'devices',
};

export function termsFor(shape: ConfigShape): Terms {
  return shape === 'accessory' ? ACCESSORY_TERMS : DEVICE_TERMS;
}

export function plural(count: number, terms: Terms): string {
  return `${count} ${count === 1 ? terms.singular : terms.plural}`;
}
