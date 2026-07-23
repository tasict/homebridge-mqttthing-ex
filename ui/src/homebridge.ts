// Typed access to the window.homebridge client API injected by
// homebridge-config-ui-x (see @homebridge/plugin-ui-utils).
import type { IHomebridgePluginUi } from '@homebridge/plugin-ui-utils/ui.interface';

export function hb(): IHomebridgePluginUi {
  return window.homebridge;
}

/** Human-readable message from a rejected homebridge.request() promise. */
export function requestErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}
