import { describe, expect, it, vi } from 'vitest';

import registerPlugin from '../src/index.js';

describe('plugin registration', () => {
  it('registers the mqttthing accessory and platform', () => {
    const registerAccessory = vi.fn();
    const registerPlatform = vi.fn();
    registerPlugin({ registerAccessory, registerPlatform } as never);
    expect(registerAccessory).toHaveBeenCalledWith(
      'homebridge-mqttthing-ex',
      'mqttthing',
      expect.any(Function),
    );
    expect(registerPlatform).toHaveBeenCalledWith(
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
      const registerPlatform = vi.fn();
      expect(() => registerPlugin({ registerAccessory, registerPlatform } as never)).not.toThrow();
      expect(errorSpy).toHaveBeenCalledOnce();
      const message = String(errorSpy.mock.calls[0][0]);
      expect(message).toContain('Uninstall homebridge-mqttthing');
      expect(message).toContain('does not need any changes');
      // platform registration is independent of the accessory failure
      expect(registerPlatform).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps accessory mode working when only the platform alias is taken', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const registerAccessory = vi.fn();
      const registerPlatform = vi.fn(() => {
        throw new Error("The requested platform 'mqttthing' has already been registered.");
      });
      expect(() => registerPlugin({ registerAccessory, registerPlatform } as never)).not.toThrow();
      expect(registerAccessory).toHaveBeenCalledOnce();
      expect(String(errorSpy.mock.calls[0][0])).toContain('Accessory mode is unaffected');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
