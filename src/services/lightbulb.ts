// Lightbulb accessory type with full colour support (HSV / RGB / RGBW /
// RGBWW / White / ColorTemperature) and adaptive lighting.
// Ported from upstream index.js:543-1172, 1352-1457 and the dispatch branch
// at index.js:2831-2858.
//
// Upstream fixes carried by this port (see docs/UpstreamIssues.md):
//
// - F1 (upstream #567 #552 #617 #686): upstream published uninitialized
//   colour defaults (e.g. '237,6,100') to set topics during construction,
//   because pushing initial characteristic values ran the sentinel-context
//   'set' events whose options.onSet chains (notably the internal colour
//   temperature's initialValue 140) recomputed hue/saturation and published.
//   In this codebase initial values are pushed with updateValue(), which
//   never invokes onSet, so constructing any lightbulb flavour publishes
//   nothing until a real HomeKit write or an MQTT state message arrives
//   (and inbound MQTT state never re-publishes either - it only calls
//   updateValue()).
//
// - F2 (upstream #431): adaptive lighting must not publish colour commands
//   while the light is off - many devices treat any colour command as a
//   power-on. Adaptive-lighting controller writes to the ColorTemperature
//   characteristic carry a distinctive HAP write context, which is detected
//   by isAdaptiveLightingWrite() and propagated through the
//   adaptiveLightingEmitter events; every publish reached exclusively from
//   that path is suppressed while state.on is false. Direct HomeKit user
//   writes publish regardless of the on state, exactly like upstream.
import type { Service } from 'homebridge';

import {
  addCharacteristic,
  integerCharacteristic,
  setCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import type { TopicSpec } from '../config.js';
import { characteristic_Brightness } from './buttons.js';
import {
  calcWhiteFactor,
  decodeRGBCommaSeparatedString,
  RGBtoScaledHSV,
  ScaledHSVtoRGB,
  toHex,
  type RGBColor,
} from './color.js';
import { registerServiceType } from './registry.js';
import { characteristic_On } from './shared.js';

/**
 * True when a ColorTemperature write originates from the adaptive lighting
 * controller. hap-nodejs's AdaptiveLightingController (AUTOMATIC mode) calls
 * handleSetRequest() with a `{ controller, omitEventUpdate }` context on
 * every scheduled transition step (AdaptiveLightingController.
 * scheduleNextUpdate), while direct HomeKit writes never carry it.
 */
function isAdaptiveLightingWrite(thing: ThingContext, context: unknown): boolean {
  return (
    typeof context === 'object' &&
    context !== null &&
    (context as { controller?: unknown }).controller instanceof thing.hap.AdaptiveLightingController
  );
}

// combined hue/saturation/brightness light (upstream index.js:543)
export function characteristics_HSVLight(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;

  let lastpubmsg = '';

  function publishNow() {
    let bri = state.bri as number;
    if (!config.topics?.setOn && !state.on) {
      bri = 0;
    }
    const msg = `${state.hue},${state.sat},${bri}`;
    if (msg != lastpubmsg) {
      thing.publish(config.topics?.setHSV, 'HSV', msg);
      lastpubmsg = msg;
    }
  }

  function publish() {
    thing.throttledCall(publishNow, 'hsv_publish', 20);
  }

  if (config.topics?.setOn) {
    characteristic_On(thing, service);
  } else {
    addCharacteristic(thing, service, 'on', hap.Characteristic.On, false, function () {
      if (state.on && state.bri == 0) {
        state.bri = 100;
      }
      publish();
    });
  }
  addCharacteristic(thing, service, 'hue', hap.Characteristic.Hue, 0, publish);
  addCharacteristic(thing, service, 'sat', hap.Characteristic.Saturation, 0, publish);
  addCharacteristic(thing, service, 'bri', hap.Characteristic.Brightness, 100, function () {
    if ((state.bri as number) > 0 && !state.on) {
      state.on = true;
    }
    publish();
  });
  // adaptive lighting listeners - like upstream's addCharacteristic
  // adaptiveEventName wiring, but with the F2 gate (see file header): events
  // flagged as controller-driven are not published while the light is off.
  addAdaptiveColourListener(thing, 'hue', publish);
  addAdaptiveColourListener(thing, 'sat', publish, 'saturation');

  if (config.topics?.getHSV) {
    thing.subscribe(config.topics.getHSV, 'HSV', function (_topic, message) {
      const comps = String(message).split(',');
      if (comps.length == 3) {
        const hue = parseInt(comps[0]);
        const sat = parseInt(comps[1]);
        const bri = parseInt(comps[2]);

        if (!config.topics?.setOn) {
          const on = bri > 0 ? 1 : 0;

          if (on != state.on) {
            state.on = on;
            setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.On), on);
          }
        }

        if (hue != state.hue) {
          thing.disableAdaptiveLighting('HSV hue');

          state.hue = hue;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Hue), hue);
        }

        if (sat != state.sat) {
          thing.disableAdaptiveLighting('HSV saturation');

          state.sat = sat;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Saturation), sat);
        }

        if (bri != state.bri) {
          state.bri = bri;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Brightness), bri);
        }
      }
    });
  }

  if (thing.supportAdaptiveLighting()) {
    characteristic_ColorTemperature_Internal(thing, service);
  }
}

/**
 * Register an adaptiveLightingEmitter listener for the HSV/RGB combined
 * lights (upstream index.js:534-539 registered these inside
 * addCharacteristic; here they are explicit so the F2 on-state gate can be
 * applied to controller-driven events).
 */
function addAdaptiveColourListener(thing: ThingContext, property: string, publish: () => void, eventName?: string): void {
  const { state } = thing;
  thing.adaptiveLightingEmitter.addListener(eventName ?? property, (value: number, fromAdaptiveLighting?: boolean) => {
    state[property] = value;
    // F2 (upstream #431): don't publish colour while the light is off when
    // the change is driven by the adaptive lighting controller
    if (fromAdaptiveLighting && !state.on) {
      return;
    }
    publish();
  });
}

interface ChannelColor extends RGBColor {
  w: number;
  ww: number;
  cw: number;
}

// RGB / RGBW / RGBWW light (upstream index.js:781)
export function characteristics_RGBLight(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;

  let warmWhiteRGB: RGBColor = { r: 255, g: 158, b: 61 };
  let coldWhiteRGB: RGBColor = { r: 204, g: 219, b: 255 };

  state.red = 0;
  state.green = 0;
  state.blue = 0;
  state.white = 0;
  state.warmWhite = 0;
  state.coldWhite = 0;

  let setTopic: TopicSpec | undefined, getTopic: TopicSpec | undefined, numComponents: number, property: string;
  let wwcwComps = false;
  let whiteComp = false;
  let whiteSep = false;
  if (config.topics?.setRGBWW) {
    setTopic = config.topics.setRGBWW;
    getTopic = config.topics.getRGBWW;
    property = 'RGBWW';
    wwcwComps = true;
    numComponents = 5;
    warmWhiteRGB = decodeRGBCommaSeparatedString(config.warmWhite) || { r: 255, g: 158, b: 61 };
    coldWhiteRGB = decodeRGBCommaSeparatedString(config.coldWhite) || { r: 204, g: 219, b: 255 };
  } else if (config.topics?.setRGBW) {
    setTopic = config.topics.setRGBW;
    getTopic = config.topics.getRGBW;
    property = 'RGBW';
    whiteComp = true;
    numComponents = 4;
  } else {
    setTopic = config.topics?.setRGB;
    getTopic = config.topics?.getRGB;
    property = 'RGB';
    if (config.topics?.setWhite) {
      whiteSep = true;
    }
    numComponents = 3;
  }

  let hexPrefix: string | null = null;
  if (config.hexPrefix) {
    hexPrefix = config.hexPrefix as string;
  } else if (config.hex) {
    hexPrefix = '';
  }

  let lastpubmsg = '';

  function publishNow() {
    let bri = state.bri as number;
    if (!config.topics?.setOn && !state.on) {
      bri = 0;
    }
    let rgb: ChannelColor = { w: 0, ww: 0, cw: 0, ...ScaledHSVtoRGB(state.hue as number, state.sat as number, bri) };
    const orig_rgb: ChannelColor = { ...rgb };

    if (wwcwComps) {
      // calculate warm-white and cold-white factors (0-1 indicating proportion of warm/cold white in colour)
      let warmFactor = calcWhiteFactor(rgb, warmWhiteRGB);
      let coldFactor = calcWhiteFactor(rgb, coldWhiteRGB);
      // sum must be below 1
      let whiteFactor = warmFactor + coldFactor;
      if (whiteFactor > 1) {
        warmFactor = warmFactor / whiteFactor;
        coldFactor = coldFactor / whiteFactor;
        whiteFactor = 1;
      }
      // manipulate RGB values
      rgb.ww = Math.floor(warmFactor * 255);
      rgb.cw = Math.floor(coldFactor * 255);
      rgb.r = Math.max(0, Math.floor(rgb.r - warmFactor * warmWhiteRGB.r - coldFactor * coldWhiteRGB.r));
      rgb.g = Math.max(0, Math.floor(rgb.g - warmFactor * warmWhiteRGB.g - coldFactor * coldWhiteRGB.g));
      rgb.b = Math.max(0, Math.floor(rgb.b - warmFactor * warmWhiteRGB.b - coldFactor * coldWhiteRGB.b));
      // any remaining pure white level can be replaced with a mixture of cold and warm white
      const min = Math.min(rgb.r, rgb.g, rgb.b, 255 - rgb.ww, 255 - rgb.cw);
      rgb.ww += Math.floor(min / 2);
      rgb.cw += Math.floor(min / 2);
      rgb.r -= min;
      rgb.g -= min;
      rgb.b -= min;

      if (config.whiteMix === false || config.noWhiteMix === true) {
        if ((rgb.ww > 0 || rgb.cw > 0) && (rgb.r > 0 || rgb.g > 0 || rgb.b > 0)) {
          // mixing white and colours is not allowed on some devices
          const redThreshold = config.redThreshold === undefined ? 15 : (config.redThreshold as number);
          const greenThreshold = config.greenThreshold === undefined ? 15 : (config.greenThreshold as number);
          const blueThreshold = config.blueThreshold === undefined ? 15 : (config.blueThreshold as number);
          if (rgb.r > redThreshold || rgb.g > greenThreshold || rgb.b > blueThreshold) {
            // colour
            rgb = orig_rgb;
          } else {
            // white
            rgb.r = 0;
            rgb.g = 0;
            rgb.b = 0;
          }
        }
      }

      // store white state
      state.warmWhite = rgb.ww;
      state.coldWhite = rgb.cw;
    } else if (whiteSep || whiteComp) {
      // remove common component from red, green and blue to white
      const min = Math.min(rgb.r, rgb.g, rgb.b);
      rgb.w = min;
      rgb.r -= min;
      rgb.g -= min;
      rgb.b -= min;

      state.white = rgb.w;
    }
    state.red = rgb.r;
    state.green = rgb.g;
    state.blue = rgb.b;

    let msg: string;
    if (hexPrefix == null) {
      // comma-separated decimal
      msg = rgb.r + ',' + rgb.g + ',' + rgb.b;
      if (whiteComp) {
        msg += ',' + rgb.w;
      } else if (wwcwComps) {
        if (config.switchWhites) {
          msg += ',' + rgb.cw + ',' + rgb.ww;
        } else {
          msg += ',' + rgb.ww + ',' + rgb.cw;
        }
      }
    } else {
      // hex
      msg = hexPrefix + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
      if (whiteComp) {
        msg += toHex(rgb.w);
      } else if (wwcwComps) {
        if (config.switchWhites) {
          msg += toHex(rgb.cw) + toHex(rgb.ww);
        } else {
          msg += toHex(rgb.ww) + toHex(rgb.cw);
        }
      }
    }
    if (msg != lastpubmsg) {
      thing.publish(setTopic, property, msg);
      lastpubmsg = msg;
    }

    if (whiteSep) {
      thing.publish(config.topics?.setWhite, 'white', rgb.w);
    }
  }

  // hold off before publishing to ensure that all updated properties are collected first
  function publish() {
    thing.throttledCall(publishNow, 'rgb_publish', 20);
  }

  if (config.topics?.setOn) {
    characteristic_On(thing, service);
  } else {
    addCharacteristic(thing, service, 'on', hap.Characteristic.On, false, function () {
      if (state.on && state.bri == 0) {
        state.bri = 100;
      }
      publish();
    });
  }
  addCharacteristic(thing, service, 'hue', hap.Characteristic.Hue, 0, publish);
  addCharacteristic(thing, service, 'sat', hap.Characteristic.Saturation, 0, publish);
  addCharacteristic(thing, service, 'bri', hap.Characteristic.Brightness, 100, function () {
    if ((state.bri as number) > 0 && !state.on) {
      state.on = true;
    }

    publish();
  });
  // adaptive lighting listeners (F2 gate - see characteristics_HSVLight)
  addAdaptiveColourListener(thing, 'hue', publish);
  addAdaptiveColourListener(thing, 'sat', publish, 'saturation');

  function updateColour(red: number, green: number, blue: number, white: number, warmWhite = 0, coldWhite = 0) {
    // add warm white/cold white in
    if (wwcwComps) {
      red += Math.floor((warmWhiteRGB.r * warmWhite) / 255) + Math.floor((coldWhiteRGB.r * coldWhite) / 255);
      green += Math.floor((warmWhiteRGB.g * warmWhite) / 255) + Math.floor((coldWhiteRGB.g * coldWhite) / 255);
      blue += Math.floor((warmWhiteRGB.b * warmWhite) / 255) + Math.floor((coldWhiteRGB.b * coldWhite) / 255);
    }

    // add any white component to red, green and blue
    red = Math.min(red + white, 255);
    green = Math.min(green + white, 255);
    blue = Math.min(blue + white, 255);

    const hsv = RGBtoScaledHSV(red, green, blue);
    const hue = Math.floor(hsv.h);
    const sat = Math.floor(hsv.s);
    const bri = Math.floor(hsv.v);

    if (!config.topics?.setOn) {
      const on = bri > 0 ? 1 : 0;

      if (on != state.on) {
        state.on = on;
        setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.On), on);
      }
    }

    if (hue != state.hue) {
      thing.disableAdaptiveLighting('calculated hue');

      state.hue = hue;
      setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Hue), hue);
    }

    if (sat != state.sat) {
      thing.disableAdaptiveLighting('calculated saturation');

      state.sat = sat;
      setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Saturation), sat);
    }

    if (bri != state.bri) {
      state.bri = bri;
      setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Brightness), bri);
    }
  }

  if (getTopic) {
    thing.subscribe(getTopic, property, function (_topic, message) {
      let ok = false;
      let red = 0,
        green = 0,
        blue = 0,
        white = 0,
        warmWhite = 0,
        coldWhite = 0;
      if (hexPrefix == null) {
        // comma-separated decimal
        const comps = String(message).split(',');
        if (comps.length == numComponents) {
          red = parseInt(comps[0]);
          green = parseInt(comps[1]);
          blue = parseInt(comps[2]);
          if (whiteComp) {
            white = parseInt(comps[3]);
          } else if (wwcwComps) {
            warmWhite = parseInt(comps[3]);
            coldWhite = parseInt(comps[4]);
            if (config.switchWhites) {
              const temp = warmWhite;
              warmWhite = coldWhite;
              coldWhite = temp;
            }
          }
          ok = true;
        }
      } else {
        // hex
        const str = String(message);
        if (str.length == hexPrefix.length + 2 * numComponents) {
          if (str.substring(0, hexPrefix.length) == hexPrefix) {
            red = parseInt(str.substring(hexPrefix.length, hexPrefix.length + 2), 16);
            green = parseInt(str.substring(hexPrefix.length + 2, hexPrefix.length + 4), 16);
            blue = parseInt(str.substring(hexPrefix.length + 4, hexPrefix.length + 6), 16);
            if (whiteComp) {
              white = parseInt(str.substring(hexPrefix.length + 6, hexPrefix.length + 8), 16);
            } else if (wwcwComps) {
              warmWhite = parseInt(str.substring(hexPrefix.length + 6, hexPrefix.length + 8), 16);
              coldWhite = parseInt(str.substring(hexPrefix.length + 8, hexPrefix.length + 10), 16);
              if (config.switchWhites) {
                const temp = warmWhite;
                warmWhite = coldWhite;
                coldWhite = temp;
              }
            }
            ok = true;
          }
        }
      }
      if (ok) {
        state.red = red;
        state.green = green;
        state.blue = blue;
        if (whiteComp) {
          state.white = white;
          updateColour(red, green, blue, white);
        } else if (wwcwComps) {
          state.warmWhite = warmWhite;
          state.coldWhite = coldWhite;
          updateColour(red, green, blue, 0, warmWhite, coldWhite);
        } else if (whiteSep) {
          updateColour(red, green, blue, state.white as number);
        } else {
          updateColour(red, green, blue, 0);
        }
      }
    });
  }

  if (whiteSep) {
    thing.subscribe(config.topics!.getWhite!, 'white', function (_topic, message) {
      state.white = parseInt(String(message));
      updateColour(state.red as number, state.green as number, state.blue as number, state.white as number);
    });
  }

  if (thing.supportAdaptiveLighting()) {
    characteristic_ColorTemperature_Internal(thing, service);
  }
}

// white light (upstream index.js:1097)
export function characteristics_WhiteLight(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;
  state.white = 0;
  let hexPrefix: string | null = null;
  if (config.hexPrefix) {
    hexPrefix = config.hexPrefix as string;
  } else if (config.hex) {
    hexPrefix = '';
  }

  function publish() {
    let bri = state.bri as number;
    if (!state.on) {
      bri = 0;
    }
    const white = Math.min(Math.ceil(bri * 2.55), 255);
    let msg: string | number;
    if (hexPrefix == null) {
      msg = white;
    } else {
      msg = hexPrefix + toHex(white);
    }
    thing.publish(config.topics?.setWhite, 'white', msg);
  }

  addCharacteristic(thing, service, 'on', hap.Characteristic.On, false, function () {
    if (state.on && state.bri == 0) {
      state.bri = 100;
    }
    publish();
  });

  addCharacteristic(thing, service, 'bri', hap.Characteristic.Brightness, 100, function () {
    if ((state.bri as number) > 0 && !state.on) {
      state.on = true;
    }

    publish();
  });

  if (config.topics?.getWhite) {
    thing.subscribe(config.topics.getWhite, 'white', function (_topic, message) {
      let ok = false;
      let white = 0;
      if (hexPrefix == null) {
        const comps = String(message).split(',');
        if (comps.length == 1) {
          white = parseInt(comps[0]);
          ok = true;
        }
      } else {
        // hex
        const str = String(message);
        if (str.length == hexPrefix.length + 2) {
          if (str.substring(0, hexPrefix.length) == hexPrefix) {
            white = parseInt(str.substring(hexPrefix.length, hexPrefix.length + 2), 16);
            ok = true;
          }
        }
      }
      if (ok) {
        const bri = Math.min(Math.floor(white / 2.55), 100);
        const on = bri > 0 ? true : false;

        if (on != state.on) {
          state.on = on;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.On), on);
        }

        if (bri != state.bri) {
          state.bri = bri;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Brightness), bri);
        }
      }
    });
  }
}

// Characteristic.Hue (upstream index.js:1407)
export function characteristic_Hue(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;
  const char = integerCharacteristic(thing, service, 'hue', hap.Characteristic.Hue, config.topics?.setHue, config.topics?.getHue, {
    onMqtt: () => thing.disableAdaptiveLighting('hue'),
  });
  if (thing.supportAdaptiveLighting()) {
    thing.adaptiveLightingEmitter.addListener('hue', (value: number, fromAdaptiveLighting?: boolean) => {
      // F2 (upstream #431): controller-driven colour changes are not
      // published while the light is off; track the value in state only
      if (fromAdaptiveLighting && !state.on) {
        state.hue = value;
        return;
      }
      char.onSet(value);
    });
  }
}

// Characteristic.Saturation (upstream index.js:1416)
export function characteristic_Saturation(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;
  const char = integerCharacteristic(thing, service, 'saturation', hap.Characteristic.Saturation, config.topics?.setSaturation, config.topics?.getSaturation, {
    onMqtt: () => thing.disableAdaptiveLighting('saturation'),
  });
  if (thing.supportAdaptiveLighting()) {
    thing.adaptiveLightingEmitter.addListener('saturation', (value: number, fromAdaptiveLighting?: boolean) => {
      // F2 (upstream #431): see characteristic_Hue
      if (fromAdaptiveLighting && !state.on) {
        state.saturation = value;
        return;
      }
      char.onSet(value);
    });
  }
}

// Characteristic.ColorTemperature (upstream index.js:1427)
export function characteristic_ColorTemperature(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;
  // integerCharacteristic() provides props/get/MQTT plumbing; the set handler
  // is registered manually below so the HAP write context is visible (needed
  // to recognize adaptive-lighting controller writes for F2).
  integerCharacteristic(thing, service, 'colorTemperature', hap.Characteristic.ColorTemperature, undefined, config.topics?.getColorTemperature, {
    initialValue: (config.minColorTemperature as number) || 140,
    minValue: config.minColorTemperature as number | undefined,
    maxValue: config.maxColorTemperature as number | undefined,
    onMqtt: () => thing.disableAdaptiveLighting('colorTemperature'),
  });

  const charac = service.getCharacteristic(hap.Characteristic.ColorTemperature);
  charac.onSet((value, context) => {
    state.colorTemperature = value;
    // F2 (upstream #431): the adaptive lighting controller (AUTOMATIC mode)
    // writes ColorTemperature on every transition step; while the light is
    // off those writes must not be published, as many devices treat any
    // colour command as a power-on. Direct HomeKit writes always publish.
    if (isAdaptiveLightingWrite(thing, context) && !state.on) {
      return;
    }
    thing.publish(config.topics?.setColorTemperature, 'colorTemperature', value);
  });

  if (thing.supportAdaptiveLighting()) {
    thing.addAdaptiveLightingController(service);
  }
}

// 'Internal' Characteristic.ColorTemperature for adaptive lighting
// implementation (upstream index.js:1441)
export function characteristic_ColorTemperature_Internal(thing: ThingContext, service: Service): void {
  const { state, hap } = thing;
  // F1 (upstream #567 #552 #617 #686): the initial value 140 is pushed with
  // updateValue() inside integerCharacteristic(), so unlike upstream the
  // set handler below does NOT run during construction and nothing is
  // published until a real ColorTemperature write arrives.
  integerCharacteristic(thing, service, 'colorTemperature', hap.Characteristic.ColorTemperature, undefined, undefined, {
    initialValue: 140,
  });

  // Manual set handler so the HAP write context is visible: writes made by
  // the adaptive lighting controller are flagged on the emitted events for
  // the F2 publish suppression in the hue/saturation listeners.
  const charac = service.getCharacteristic(hap.Characteristic.ColorTemperature);
  charac.onSet((value, context) => {
    state.colorTemperature = value;
    const fromAdaptiveLighting = isAdaptiveLightingWrite(thing, context);
    // update saturation and hue to match
    const calc = hap.ColorUtils.colorTemperatureToHueAndSaturation(value as number);
    service.getCharacteristic(hap.Characteristic.Saturation).updateValue(calc.saturation);
    service.getCharacteristic(hap.Characteristic.Hue).updateValue(calc.hue);
    thing.adaptiveLightingEmitter.emit('saturation', calc.saturation, fromAdaptiveLighting);
    thing.adaptiveLightingEmitter.emit('hue', calc.hue, fromAdaptiveLighting);
  });

  if (thing.supportAdaptiveLighting()) {
    thing.addAdaptiveLightingController(service);
  }
}

// lightbulb (upstream index.js:2831-2858)
registerServiceType('lightbulb', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Lightbulb(config.name, config.subtype);
  if (config.topics?.setHSV) {
    characteristics_HSVLight(thing, service);
  } else if (config.topics?.setRGB || config.topics?.setRGBW || config.topics?.setRGBWW) {
    characteristics_RGBLight(thing, service);
  } else if (config.topics?.setWhite) {
    characteristics_WhiteLight(thing, service);
  } else {
    if (config.topics?.setOn || !config.topics?.setBrightness) {
      characteristic_On(thing, service);
    }
    if (config.topics?.setBrightness) {
      characteristic_Brightness(thing, service);
    }
    if (config.topics?.setHue) {
      characteristic_Hue(thing, service);
    }
    if (config.topics?.setSaturation) {
      characteristic_Saturation(thing, service);
    }
    if (config.topics?.setColorTemperature) {
      characteristic_ColorTemperature(thing, service);
    } else if (thing.supportAdaptiveLighting() && config.topics?.setHue && config.topics?.setSaturation) {
      // no color temperature topic, but support color - so add temperature for adaptive lighting
      characteristic_ColorTemperature_Internal(thing, service);
    }
  }
  return { service };
});
