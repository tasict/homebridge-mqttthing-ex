// Fan-style accessory types: fan, fanv2, airPurifier.
// Ported from upstream index.js dispatch branches (3148-3158, 3486-3508, 3459-3485).
import type { Service } from 'homebridge';

import {
  booleanCharacteristic,
  floatCharacteristic,
  multiCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import {
  characteristic_Active,
  characteristic_LockPhysicalControls,
  characteristic_RotationDirection,
  characteristic_RotationSpeed,
  characteristic_SwingMode,
} from './controls.js';
import { registerServiceType } from './registry.js';
import { characteristic_On } from './shared.js';

// Characteristic.CurrentAirPurifierState (upstream index.js:2318)
function characteristic_CurrentAirPurifierState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.currentAirPurifierStateValues as unknown[] | undefined;
  if (!values) {
    values = ['INACTIVE', 'IDLE', 'PURIFYING'];
  }
  multiCharacteristic(
    thing,
    service,
    'currentAirPurifierState',
    hap.Characteristic.CurrentAirPurifierState,
    undefined,
    config.topics?.getCurrentAirPurifierState,
    values,
    hap.Characteristic.CurrentAirPurifierState.INACTIVE,
  );
}

// Characteristic.TargetAirPurifierState (upstream index.js:2327)
function characteristic_TargetAirPurifierState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.targetAirPurifierStateValues as unknown[] | undefined;
  if (!values) {
    values = ['MANUAL', 'AUTO'];
  }
  multiCharacteristic(
    thing,
    service,
    'targetAirPurifierState',
    hap.Characteristic.TargetAirPurifierState,
    config.topics?.setTargetAirPurifierState,
    config.topics?.getTargetAirPurifierState,
    values,
    hap.Characteristic.TargetAirPurifierState.AUTO,
  );
}

// Characteristic.CurrentFanState (upstream index.js:2335)
function characteristic_CurrentFanState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.currentFanValues as unknown[] | undefined;
  if (!values) {
    values = ['INACTIVE', 'IDLE', 'BLOWING_AIR'];
  }
  multiCharacteristic(
    thing,
    service,
    'currentFanState',
    hap.Characteristic.CurrentFanState,
    undefined,
    config.topics?.getCurrentFanState,
    values,
    hap.Characteristic.CurrentFanState.INACTIVE,
  );
}

// Characteristic.TargetFanState (upstream index.js:2344)
function characteristic_TargetFanState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.targetFanStateValues as unknown[] | undefined;
  if (!values) {
    values = ['MANUAL', 'AUTO'];
  }
  multiCharacteristic(
    thing,
    service,
    'targetFanState',
    hap.Characteristic.TargetFanState,
    config.topics?.setTargetFanState,
    config.topics?.getTargetFanState,
    values,
    hap.Characteristic.TargetFanState.AUTO,
  );
}

// Characteristic.FilterChangeIndication (upstream index.js:2776)
function characteristic_FilterChangeIndication(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'filterChangeIndication', hap.Characteristic.FilterChangeIndication, undefined, config.topics?.getFilterChangeIndication, {
    initialValue: false,
    mapValueFunc: (val) =>
      val ? hap.Characteristic.FilterChangeIndication.CHANGE_FILTER : hap.Characteristic.FilterChangeIndication.FILTER_OK,
  });
}

// Characteristic.FilterLifeLevel (upstream index.js:2783)
function characteristic_FilterLifeLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'filterLifeLevel', hap.Characteristic.FilterLifeLevel, undefined, config.topics?.getFilterLifeLevel, 100);
}

// Characteristic.ResetFilterIndication (upstream index.js:2788)
function characteristic_ResetFilterIndication(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'resetFilterIndication', hap.Characteristic.ResetFilterIndication, config.topics?.setResetFilterIndication, undefined, {
    initialValue: false,
  });
}

// fan (upstream index.js:3148-3158)
registerServiceType('fan', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Fan(config.name, config.subtype);
  if (config.topics?.setOn || !config.topics?.setRotationSpeed) {
    characteristic_On(thing, service);
  }
  if (config.topics?.getRotationDirection || config.topics?.setRotationDirection) {
    characteristic_RotationDirection(thing, service);
  }
  if (config.topics?.getRotationSpeed || config.topics?.setRotationSpeed) {
    characteristic_RotationSpeed(thing, service, true);
  }
  return { service };
});

// airPurifier (upstream index.js:3459-3485)
registerServiceType('airPurifier', (thing) => {
  const { config, hap } = thing;
  const svcNames = (config.serviceNames || {}) as Record<string, string | undefined>;
  const service = new hap.Service.AirPurifier(config.name, config.subtype);
  characteristic_Active(thing, service);
  characteristic_CurrentAirPurifierState(thing, service);
  characteristic_TargetAirPurifierState(thing, service);
  if (config.topics?.getRotationSpeed || config.topics?.setRotationSpeed) {
    characteristic_RotationSpeed(thing, service);
  }
  if (config.topics?.getSwingMode || config.topics?.setSwingMode) {
    characteristic_SwingMode(thing, service);
  }
  if (config.topics?.setLockPhysicalControls || config.topics?.getLockPhysicalControls) {
    characteristic_LockPhysicalControls(thing, service);
  }
  const services = [service];
  if (config.topics?.getFilterChangeIndication || config.topics?.getFilterLifeLevel || config.topics?.setResetFilterIndication) {
    const filterSvc = new hap.Service.FilterMaintenance(svcNames.filter || config.name + '-Filter', config.subtype);
    service.addLinkedService(filterSvc);
    characteristic_FilterChangeIndication(thing, filterSvc); // required
    if (config.topics?.getFilterLifeLevel) {
      characteristic_FilterLifeLevel(thing, filterSvc);
    }
    if (config.topics?.setResetFilterIndication) {
      characteristic_ResetFilterIndication(thing, filterSvc);
    }
    services.push(filterSvc);
  }
  return { service, services };
});

// fanv2 (upstream index.js:3486-3508)
registerServiceType('fanv2', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Fanv2(config.name, config.subtype);
  characteristic_Active(thing, service);
  // upstream quirk: reads config.getCurrentFanState (not topics) - preserved for compatibility
  if (config.getCurrentFanState) {
    characteristic_CurrentFanState(thing, service);
  }
  if (config.topics?.setTargetFanState || config.topics?.getTargetFanState) {
    characteristic_TargetFanState(thing, service);
  }
  if (config.topics?.setLockPhysicalControls || config.topics?.getLockPhysicalControls) {
    characteristic_LockPhysicalControls(thing, service);
  }
  if (config.topics?.getRotationDirection || config.topics?.setRotationDirection) {
    characteristic_RotationDirection(thing, service);
  }
  if (config.topics?.getRotationSpeed || config.topics?.setRotationSpeed) {
    characteristic_RotationSpeed(thing, service);
  }

  if (config.topics?.getSwingMode || config.topics?.setSwingMode) {
    characteristic_SwingMode(thing, service);
  }
  const services = [service];
  return { service, services };
});
