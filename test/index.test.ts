import { describe, expect, it, vi } from 'vitest';

import registerPlugin from '../src/index.js';

describe('plugin registration', () => {
  it('registers the mqttthing accessory', () => {
    const registerAccessory = vi.fn();
    registerPlugin({ registerAccessory } as never);
    expect(registerAccessory).toHaveBeenCalledWith(
      'homebridge-mqttthing-ex',
      'mqttthing',
      expect.any(Function),
    );
  });

  it('degrades gracefully when the alias is already registered by the old plugin', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const registerAccessory = vi.fn(() => {
        throw new Error("The requested accessory 'mqttthing' has already been registered.");
      });
      expect(() => registerPlugin({ registerAccessory } as never)).not.toThrow();
      expect(errorSpy).toHaveBeenCalledOnce();
      const message = String(errorSpy.mock.calls[0][0]);
      expect(message).toContain('Uninstall homebridge-mqttthing');
      expect(message).toContain('does not need any changes');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
