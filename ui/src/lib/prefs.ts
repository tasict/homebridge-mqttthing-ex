// Small UI preferences that outlive a session.
//
// The Homebridge UI serves this page from its own origin, so localStorage is
// available - but it is wrapped anyway: if storage is blocked the "New" hint
// simply keeps showing, which is the harmless direction to fail in.
const INTRO_SEEN_KEY = 'mqttthing-ex.platformIntroSeen';

export function introSeen(): boolean {
  try {
    return window.localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // nothing to do: the hint stays visible
  }
}
