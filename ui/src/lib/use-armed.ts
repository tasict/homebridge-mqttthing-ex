// Two-step confirmation state: the first click arms an action, the second
// performs it, and the armed state relaxes on its own after a few seconds.
//
// Native dialogs are unavailable here (the Homebridge UI sandboxes this page
// without allow-modals), so confirmation always happens in the page.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Armed {
  armed: boolean;
  arm: () => void;
  reset: () => void;
}

export function useArmed(timeoutMs = 4000): Armed {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clear, []);

  return {
    armed,
    arm: () => {
      setArmed(true);
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        setArmed(false);
      }, timeoutMs);
    },
    reset: () => {
      clear();
      setArmed(false);
    },
  };
}
