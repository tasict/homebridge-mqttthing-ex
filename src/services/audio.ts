// Audio accessory types: microphone, speaker.
// Ported from upstream index.js dispatch branches (3166-3177).
import type { Service } from 'homebridge';

import { booleanCharacteristic, floatCharacteristic, type ThingContext } from '../hap/binding.js';
import { registerServiceType } from './registry.js';

// Characteristic.Volume (upstream index.js:1854)
export function characteristic_Volume(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'volume', hap.Characteristic.Volume, config.topics?.setVolume, config.topics?.getVolume, 0);
}

// Characteristic.Mute (upstream index.js:1859)
export function characteristic_Mute(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'mute', hap.Characteristic.Mute, config.topics?.setMute, config.topics?.getMute);
}

// microphone (upstream index.js:3166-3171)
registerServiceType('microphone', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Microphone(config.name, config.subtype);
  characteristic_Mute(thing, service);
  if (config.topics?.setVolume || config.topics?.getVolume) {
    characteristic_Volume(thing, service);
  }
  return { service };
});

// speaker (upstream index.js:3172-3177)
registerServiceType('speaker', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Speaker(config.name, config.subtype);
  characteristic_Mute(thing, service);
  if (config.topics?.setVolume || config.topics?.getVolume) {
    characteristic_Volume(thing, service);
  }
  return { service };
});
