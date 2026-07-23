// Colour conversion helpers for the lightbulb accessory type, ported from
// upstream index.js:630-780. The maths is kept identical (including all
// Math.floor/Math.round placement) so published channel values match the
// original plugin exactly.

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/*
 * HSV to RGB conversion from https://stackoverflow.com/questions/17242144/javascript-convert-hsb-hsv-color-to-rgb-accurately
 * (upstream index.js:637). h, s and v are fractions of 1.
 */
export function HSVtoRGB(h: number, s: number, v: number): RGBColor {
  let r = 0,
    g = 0,
    b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/** Upstream index.js:662 - h in [0,360], s and v in [0,100]. */
export function ScaledHSVtoRGB(h: number, s: number, v: number): RGBColor {
  return HSVtoRGB(h / 360, s / 100, v / 100);
}

/** Upstream index.js:671 - returns h, s and v as fractions of 1. */
export function RGBtoHSV(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    s = max === 0 ? 0 : d / max,
    v = max / 255;
  let h = 0;

  // upstream uses switch( max ) { case min: ...; case r: ...; ... } - the
  // first matching case wins, replicated here with if/else in the same order
  if (max === min) {
    h = 0;
  } else if (max === r) {
    h = g - b + d * (g < b ? 6 : 0);
    h /= 6 * d;
  } else if (max === g) {
    h = b - r + d * 2;
    h /= 6 * d;
  } else if (max === b) {
    h = r - g + d * 4;
    h /= 6 * d;
  }

  return { h, s, v };
}

/** Upstream index.js:695 - h in [0,360], s and v in [0,100]. */
export function RGBtoScaledHSV(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const hsv = RGBtoHSV(r, g, b);
  return {
    h: hsv.h * 360,
    s: hsv.s * 100,
    v: hsv.v * 100,
  };
}

/** Byte to 2-characters of hex (upstream index.js:705). */
export function toHex(num: number): string {
  const s = '0' + num.toString(16);
  return s.substring(s.length - 2);
}

/**
 * Decode 'r,g,b' strings, e.g. the warmWhite/coldWhite config values
 * (upstream index.js:710). Upstream keeps the components as strings and
 * relies on JavaScript arithmetic coercion; we convert with Number() up
 * front, which yields identical results in all subsequent calculations.
 */
export function decodeRGBCommaSeparatedString(rgb: unknown): RGBColor | undefined {
  if (rgb) {
    const comps = String(rgb).split(',');
    if (comps.length == 3) {
      return { r: Number(comps[0]), g: Number(comps[1]), b: Number(comps[2]) };
    }
  }
}

/** Upstream index.js:742. */
export function calcWhiteFactor2(rgbin: RGBColor, white: RGBColor): number {
  // scale rgb value to full brightness as comparing colours
  const compmax = Math.max(rgbin.r, rgbin.g, rgbin.b);
  if (compmax < 1) {
    return 0;
  }
  const rgbsc = 255 / compmax;
  const rgb = { r: rgbin.r * rgbsc, g: rgbin.g * rgbsc, b: rgbin.b * rgbsc };
  // calculate factors
  const wmin = Math.min(white.r, white.g, white.b);
  const cmin = Math.min(rgb.r, rgb.g, rgb.b);
  let rf = 1,
    gf = 1,
    bf = 1;
  if (white.r > wmin) {
    rf = (rgb.r - cmin) / (white.r - wmin) / rgbsc;
  }
  if (white.g > wmin) {
    gf = (rgb.g - cmin) / (white.g - wmin) / rgbsc;
  }
  if (white.b > wmin) {
    bf = (rgb.b - cmin) / (white.b - wmin) / rgbsc;
  }

  return Math.min(Math.max(0, Math.min(rf, gf, bf)), 1);
}

/** Upstream index.js:767. */
export function calcWhiteFactor(rgb: RGBColor, white: RGBColor): number {
  let rf = 1,
    gf = 1,
    bf = 1;
  if (white.r > 0) {
    rf = rgb.r / white.r;
  }
  if (white.g > 0) {
    gf = rgb.g / white.g;
  }
  if (white.b > 0) {
    bf = rgb.b / white.b;
  }
  return Math.min(Math.max(0, Math.min(rf, gf, bf, calcWhiteFactor2(rgb, white))), 1);
}
