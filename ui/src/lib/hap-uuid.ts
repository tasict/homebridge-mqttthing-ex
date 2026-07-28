// HomeKit accessory UUIDs, computed the same way Homebridge does.
//
// The editor needs these to pin a device's identity while it is being moved,
// and to spot two devices that would end up as the same HomeKit accessory.
// Homebridge derives them with SHA-1 (hap-nodejs uuid.generate), which is
// reimplemented here: the browser's own SHA-1 lives behind crypto.subtle,
// which is unavailable when the Homebridge UI is served over plain HTTP.
//
// test/ui-hap-uuid.test.ts checks this against hap-nodejs itself.
import { IDENTITY_PREFIX } from '../../../src/model/identity.js';

/** SHA-1 of the UTF-8 encoding of `input`, as lowercase hex. */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const mixed = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (mixed << 1) | (mixed >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((word) => word.toString(16).padStart(8, '0')).join('');
}

/** hap-nodejs uuid.generate(): SHA-1 hex laid into the UUID shape. */
export function hapUuidFrom(data: string): string {
  const hash = sha1Hex(data);
  let index = -1;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    index += 1;
    if (character === 'y') {
      return ((parseInt('0x' + hash[index], 16) & 0x3) | 0x8).toString(16);
    }
    return hash[index];
  });
}

/**
 * The HomeKit accessory UUID for a device identified by `seed`. Homebridge
 * uses the accessory alias as the prefix, which is why moving a device
 * between the two configuration formats can keep its identity.
 */
export function accessoryUuid(seed: string): string {
  return hapUuidFrom(IDENTITY_PREFIX + seed);
}

/** A fresh random UUID (v4). crypto.getRandomValues needs no secure context. */
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
