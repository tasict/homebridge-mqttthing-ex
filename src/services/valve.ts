// valve accessory type (also the home of the Active/InUse/duration helpers
// shared with the future irrigationSystem port).
// Ported from upstream index.js dispatch branch (3303-3314).
import type { Service } from 'homebridge';

import {
  addCharacteristic,
  booleanCharacteristic,
  integerCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import type { ThingConfig } from '../config.js';
import { registerServiceType } from './registry.js';
import { addSensorOptionalCharacteristics } from './shared.js';

// Characteristic.Active (upstream index.js:2487)
export function characteristic_Active(thing: ThingContext, service: Service, subIdx?: number, subConfig?: ThingConfig): void {
  const { config, state, hap } = thing;
  let property_active = 'active';
  let topic_setActive = config.topics?.setActive;
  let topic_getActive = config.topics?.getActive;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_active = property_active + '-' + subIdx;
    topic_setActive = subConfig.topics?.setActive;
    topic_getActive = subConfig.topics?.getActive;
    if (!state.activePropertyList) {
      state.activePropertyList = [property_active];
    } else {
      (state.activePropertyList as string[]).push(property_active);
    }
  }
  booleanCharacteristic(thing, service, property_active, hap.Characteristic.Active, topic_setActive, topic_getActive, {
    initialValue: false,
    mapValueFunc: (val) => (val ? hap.Characteristic.Active.ACTIVE : hap.Characteristic.Active.INACTIVE),
    turnOffAfterms: config.turnOffAfterms as number | undefined,
  });
}

// Characteristic.InUse (upstream index.js:2508)
export function characteristic_InUse(thing: ThingContext, service: Service, subIdx?: number, subConfig?: ThingConfig): void {
  const { config, state, hap } = thing;
  let property_inUse = 'inUse';
  let topic_getInUse = config.topics?.getInUse;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_inUse = property_inUse + '-' + subIdx;
    topic_getInUse = subConfig.topics?.getInUse;
    if (!state.inUsePropertyList) {
      state.inUsePropertyList = [property_inUse];
    } else {
      (state.inUsePropertyList as string[]).push(property_inUse);
    }
  }
  booleanCharacteristic(thing, service, property_inUse, hap.Characteristic.InUse, undefined, topic_getInUse, {
    initialValue: false,
    mapValueFunc: (val) => (val ? hap.Characteristic.InUse.IN_USE : hap.Characteristic.InUse.NOT_IN_USE),
  });
}

// Characteristic.SetDuration (upstream index.js:2585)
export function characteristic_SetDuration(thing: ThingContext, service: Service, subIdx?: number, subConfig?: ThingConfig): void {
  const { config, state, hap, log } = thing;
  let property_setDuration = 'setDuration';
  let topic_setDuration = config.topics?.setDuration;
  let topic_getDuration = config.topics?.getDuration;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_setDuration = property_setDuration + '-' + subIdx;
    if (subConfig.topics?.setDuration) {
      topic_setDuration = subConfig.topics.setDuration;
    }
    if (subConfig.topics?.getDuration) {
      topic_getDuration = subConfig.topics.getDuration;
    }
  }

  let initialValue = 1200;
  if (config.minDuration !== undefined && initialValue < (config.minDuration as number)) {
    initialValue = config.minDuration as number;
  } else if (config.maxDuration !== undefined && initialValue > (config.maxDuration as number)) {
    initialValue = config.maxDuration as number;
  }

  if (!topic_setDuration) {
    /* no topic specified, but property is still created internally */
    addCharacteristic(thing, service, property_setDuration, hap.Characteristic.SetDuration, initialValue, () => {
      // upstream logs with log.debug, which the minimal Log interface may not provide
      (log as unknown as { debug?: (msg: string) => void }).debug?.('set "' + property_setDuration + '" to ' + state[property_setDuration] + 's.');
    });
  } else {
    integerCharacteristic(thing, service, property_setDuration, hap.Characteristic.SetDuration, topic_setDuration, topic_getDuration, { initialValue });
  }
  // minimum/maximum duration (upstream mutates charac.props directly)
  if (config.minDuration !== undefined || config.maxDuration !== undefined) {
    const charac = service.getCharacteristic(hap.Characteristic.SetDuration)!;
    if (config.minDuration !== undefined) {
      charac.props.minValue = config.minDuration as number;
    }
    if (config.maxDuration !== undefined) {
      charac.props.maxValue = config.maxDuration as number;
    }
  }
}

// Characteristic.RemainingDuration (upstream index.js:2628)
export function characteristic_RemainingDuration(thing: ThingContext, service: Service, subIdx?: number, subConfig?: ThingConfig): void {
  const { config, state, hap } = thing;
  let property_active = 'active';
  let property_inUse = 'inUse';
  let property_setDuration = 'setDuration';
  let property_durationEndTime = 'durationEndTime';
  let topic_getRemainingDuration = config.topics?.getRemainingDuration;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_active = property_active + '-' + subIdx;
    property_inUse = property_inUse + '-' + subIdx;
    property_setDuration = property_setDuration + '-' + subIdx;
    property_durationEndTime = property_durationEndTime + '-' + subIdx;
    topic_getRemainingDuration = subConfig.topics?.getRemainingDuration;
  }
  // Instead of saving the remaining duration, the time of the expected end is stored.
  // This makes it easier to respond to following GET queries from HomeKit.
  state[property_durationEndTime] = Math.floor(Date.now() / 1000);

  function getRemainingDuration(): number {
    const remainingDuration = (state[property_durationEndTime] as number) - Math.floor(Date.now() / 1000);
    return state[property_inUse] && remainingDuration > 0 ? remainingDuration : 0;
  }

  // set up characteristic
  const charac = service.addCharacteristic(hap.Characteristic.RemainingDuration);
  charac.onGet(() => {
    if (thing.isOffline()) {
      throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return getRemainingDuration();
  });
  const characActive = service.getCharacteristic(hap.Characteristic.Active)!;
  const characInUse = service.getCharacteristic(hap.Characteristic.InUse)!;

  // duration timer function
  let durationTimer: NodeJS.Timeout | null = null;

  function timerFunc() {
    durationTimer = null;
    state[property_active] = false;
    // setValue() invokes the onSet handler, so this also publishes a MQTT
    // message (upstream: setValue(INACTIVE, undefined, 'time expired'))
    characActive.setValue(hap.Characteristic.Active.INACTIVE);
  }

  // update durationEndTime once when 'Active' changes to ACTIVE
  if (service.testCharacteristic(hap.Characteristic.SetDuration)) {
    if (config.durationTimer) {
      // add durationTimer (turn off timer)
      characInUse.on('change', (obj) => {
        if (obj.newValue == hap.Characteristic.InUse.IN_USE) {
          state[property_durationEndTime] = Math.floor(Date.now() / 1000) + (state[property_setDuration] as number);
          durationTimer = setTimeout(timerFunc, (state[property_setDuration] as number) * 1000);
        } else {
          if (durationTimer) {
            clearTimeout(durationTimer);
          }
        }
        charac.updateValue(getRemainingDuration());
      });
    } else {
      // device will handle the timer by itself
      characInUse.on('change', (obj) => {
        if (obj.newValue == hap.Characteristic.InUse.IN_USE) {
          state[property_durationEndTime] = Math.floor(Date.now() / 1000) + (state[property_setDuration] as number);
        }
        charac.updateValue(getRemainingDuration());
      });
    }
  } else if (config.turnOffAfterms) {
    // no SetDuration Characteristic configured, but turnOffAfterms
    characActive.on('change', (obj) => {
      if (obj.newValue == hap.Characteristic.Active.ACTIVE) {
        state[property_durationEndTime] = Math.floor((Date.now() + (config.turnOffAfterms as number)) / 1000);
      }
      charac.updateValue(getRemainingDuration());
    });
  }

  // update durationEndTime once when 'SetDuration' changes (if 'SetDuration' exists)
  if (service.testCharacteristic(hap.Characteristic.SetDuration)) {
    service.getCharacteristic(hap.Characteristic.SetDuration)!.on('change', (obj) => {
      // extend or shorten duration
      const maxEndTime = Math.floor(Date.now() / 1000) + (obj.newValue as number);
      const newEndTime = (state[property_durationEndTime] as number) + ((obj.newValue as number) - (obj.oldValue as number));
      state[property_durationEndTime] = newEndTime < maxEndTime ? newEndTime : maxEndTime;
      charac.updateValue(getRemainingDuration());
      if (durationTimer) {
        // update timer
        clearTimeout(durationTimer);
        durationTimer = setTimeout(timerFunc, getRemainingDuration() * 1000);
      }
    });
  }

  // subscribe to get topic, update remainingDuration
  if (topic_getRemainingDuration) {
    thing.subscribe(topic_getRemainingDuration, 'remainingDuration', (_topic, message) => {
      const remainingDuration = parseInt(String(message));
      state[property_durationEndTime] = Math.floor(Date.now() / 1000) + remainingDuration;
      charac.updateValue(remainingDuration);
      if (durationTimer) {
        // update timer
        clearTimeout(durationTimer);
        durationTimer = setTimeout(timerFunc, remainingDuration * 1000);
      }
    });
  }
}

// Characteristic.ValveType (upstream index.js:2735)
export function characteristic_ValveType(thing: ThingContext, service: Service, valveType?: number | null): void {
  const { config, hap } = thing;
  if (valveType === undefined || valveType === null) {
    // if not specified by argument, use specification from config file
    if (config.valveType === 'sprinkler') {
      valveType = hap.Characteristic.ValveType.IRRIGATION;
    } else if (config.valveType === 'shower') {
      valveType = hap.Characteristic.ValveType.SHOWER_HEAD;
    } else if (config.valveType === 'faucet') {
      valveType = hap.Characteristic.ValveType.WATER_FAUCET;
    } else {
      valveType = hap.Characteristic.ValveType.GENERIC_VALVE;
    }
  }
  service.setCharacteristic(hap.Characteristic.ValveType, valveType);
}

// valve (upstream index.js:3303-3314)
registerServiceType('valve', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Valve(config.name, config.subtype);
  characteristic_ValveType(thing, service);
  characteristic_Active(thing, service);
  characteristic_InUse(thing, service);
  if (config.topics?.setDuration || config.durationTimer) {
    characteristic_SetDuration(thing, service);
    characteristic_RemainingDuration(thing, service);
  } else if (config.topics?.getRemainingDuration || config.turnOffAfterms) {
    characteristic_RemainingDuration(thing, service);
  }
  addSensorOptionalCharacteristics(thing, service);
  return { service };
});
