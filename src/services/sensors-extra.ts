// Additional sensor accessory types: contactSensor, smokeSensor, leakSensor.
// Ported from upstream index.js dispatch branches (3025-3036, 3121-3124,
// 3159-3165).
import type { Service } from 'homebridge';

import { history_ContactSensorState, makeHistoryService } from '../features/history.js';
import { booleanCharacteristic, integerCharacteristic, type ThingContext } from '../hap/binding.js';
import { registerServiceType } from './registry.js';
import {
  addSensorOptionalCharacteristics,
  characteristic_LeakDetected,
} from './shared.js';

// Characteristic.ContactSensorState (upstream index.js:1768)
// NOTE inverted polarity (upstream quirk): true maps to CONTACT_NOT_DETECTED.
export function characteristic_ContactSensorState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(
    thing,
    service,
    'contactSensorState',
    hap.Characteristic.ContactSensorState,
    undefined,
    config.topics?.getContactSensorState,
    {
      initialValue: false,
      mapValueFunc: (val) =>
        val
          ? hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : hap.Characteristic.ContactSensorState.CONTACT_DETECTED,
      resetStateAfterms: config.resetStateAfterms as number | undefined,
    },
  );
}

// Characteristic.SmokeDetected (upstream index.js:1886)
export function characteristic_SmokeDetected(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'smokeDetected', hap.Characteristic.SmokeDetected, undefined, config.topics?.getSmokeDetected, {
    initialValue: false,
    mapValueFunc: (val) =>
      val ? hap.Characteristic.SmokeDetected.SMOKE_DETECTED : hap.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
    resetStateAfterms: config.resetStateAfterms as number | undefined,
  });
}

// Characteristic.WaterLevel (upstream index.js:2074)
export function characteristic_WaterLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  const options = { minValue: 0, maxValue: 100 };
  integerCharacteristic(thing, service, 'waterLevel', hap.Characteristic.WaterLevel, config.topics?.setWaterLevel, config.topics?.getWaterLevel, options);
}

// contactSensor (upstream index.js:3025-3036)
registerServiceType('contactSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.ContactSensor(config.name, config.subtype);
  characteristic_ContactSensorState(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  // 'door' history (upstream index.js:3030-3036); history_ContactSensorState
  // adds LastActivation, TimesOpened/ResetTotal counter persistence and
  // Open/ClosedDuration
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'door', true);
    if (historySvc) {
      history_ContactSensorState(thing, historySvc, service);
      // return history service too
      services.push(historySvc);
    }
  }
  return { service, services };
});

// smokeSensor (upstream index.js:3121-3124)
registerServiceType('smokeSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.SmokeSensor(config.name, config.subtype);
  characteristic_SmokeDetected(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  return { service };
});

// leakSensor (upstream index.js:3159-3165)
registerServiceType('leakSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.LeakSensor(config.name, config.subtype);
  characteristic_LeakDetected(thing, service);
  if (config.topics?.setWaterLevel || config.topics?.getWaterLevel) {
    characteristic_WaterLevel(thing, service);
  }
  addSensorOptionalCharacteristics(thing, service);
  return { service };
});
