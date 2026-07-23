// irrigationSystem accessory type.
// Ported from upstream index.js dispatch branch (3422-3458).
import type { Service } from 'homebridge';

import {
  addCharacteristic,
  integerCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import {
  characteristic_Active,
  characteristic_InUse,
  type SubServiceConfig,
} from './controls.js';
import { registerServiceType } from './registry.js';
import { characteristic_StatusFault } from './shared.js';

// Characteristic.ServiceLabelIndex (upstream index.js:2382)
function characteristic_ServiceLabelIndex(thing: ThingContext, service: Service, index: number): void {
  service.setCharacteristic(thing.hap.Characteristic.ServiceLabelIndex, index);
}

// Characteristic.SetDuration (upstream index.js:2585)
function characteristic_SetDuration(thing: ThingContext, service: Service, subIdx?: number, subConfig?: SubServiceConfig): void {
  const { config, hap, log, state } = thing;
  let property_setDuration = 'setDuration';
  let topic_setDuration = config.topics?.setDuration;
  let topic_getDuration = config.topics?.getDuration;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_setDuration = property_setDuration + '-' + subIdx;
    if (subConfig.topics.setDuration) {
      topic_setDuration = subConfig.topics.setDuration;
    }
    if (subConfig.topics.getDuration) {
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
      // upstream logs at debug level; the homebridge logger provides debug()
      (log as unknown as { debug?: (message: string) => void }).debug?.(
        'set "' + property_setDuration + '" to ' + state[property_setDuration] + 's.',
      );
    });
  } else {
    integerCharacteristic(thing, service, property_setDuration, hap.Characteristic.SetDuration, topic_setDuration, topic_getDuration, { initialValue });
  }
  // minimum/maximum duration
  if (config.minDuration !== undefined || config.maxDuration !== undefined) {
    const charac = service.getCharacteristic(hap.Characteristic.SetDuration)!;
    const props: { minValue?: number; maxValue?: number } = {};
    if (config.minDuration !== undefined) {
      props.minValue = config.minDuration as number;
    }
    if (config.maxDuration !== undefined) {
      props.maxValue = config.maxDuration as number;
    }
    try {
      charac.setProps(props);
    } catch (ex) {
      log.warn(`Ignoring invalid duration range ${JSON.stringify(props)} for ${charac.displayName} - ${ex}`);
    }
  }
}

// Characteristic.RemainingDuration (upstream index.js:2628)
function characteristic_RemainingDuration(thing: ThingContext, service: Service, subIdx?: number, subConfig?: SubServiceConfig): void {
  const { config, hap, state } = thing;
  const { Characteristic } = hap;
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
    topic_getRemainingDuration = subConfig.topics.getRemainingDuration;
  }
  // Instead of saving the remaining duration, the time of the expected end is stored.
  // This makes it easier to respond to following GET queries from HomeKit.
  state[property_durationEndTime] = Math.floor(Date.now() / 1000);

  function getRemainingDuration(): number {
    const remainingDuration = (state[property_durationEndTime] as number) - Math.floor(Date.now() / 1000);
    return state[property_inUse] && remainingDuration > 0 ? remainingDuration : 0;
  }

  // set up characteristic
  const charac = service.addCharacteristic(Characteristic.RemainingDuration);
  charac.onGet(() => {
    if (thing.isOffline()) {
      throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return getRemainingDuration();
  });
  const characActive = service.getCharacteristic(Characteristic.Active)!;
  const characInUse = service.getCharacteristic(Characteristic.InUse)!;

  // duration timer function
  let durationTimer: NodeJS.Timeout | null = null;

  function timerFunc(): void {
    durationTimer = null;
    state[property_active] = false;
    characActive.setValue(Characteristic.Active.INACTIVE, 'time expired');
    // this will also publish a MQTT message
  }

  // update durationEndTime once when 'Active' changes to ACTIVE
  if (service.testCharacteristic(Characteristic.SetDuration)) {
    if (config.durationTimer) {
      // add durationTimer (turn off timer)
      characInUse.on('change', (obj) => {
        if (obj.newValue == Characteristic.InUse.IN_USE) {
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
        if (obj.newValue == Characteristic.InUse.IN_USE) {
          state[property_durationEndTime] = Math.floor(Date.now() / 1000) + (state[property_setDuration] as number);
        }
        charac.updateValue(getRemainingDuration());
      });
    }
  } else if (config.turnOffAfterms) {
    // no SetDuration Characteristic configured, but turnOffAfterms
    characActive.on('change', (obj) => {
      if (obj.newValue == Characteristic.Active.ACTIVE) {
        state[property_durationEndTime] = Math.floor((Date.now() + (config.turnOffAfterms as number)) / 1000);
      }
      charac.updateValue(getRemainingDuration());
    });
  }

  // update durationEndTime once when 'SetDuration' changes (if 'SetDuration' exists)
  if (service.testCharacteristic(Characteristic.SetDuration)) {
    service.getCharacteristic(Characteristic.SetDuration)!.on('change', (obj) => {
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
function characteristic_ValveType(thing: ThingContext, service: Service, valveType?: number): void {
  const { config, hap } = thing;
  const { Characteristic } = hap;
  if (valveType === undefined || valveType === null) {
    // if not specified by argument, use specification from config file
    if (config.valveType === 'sprinkler') {
      valveType = Characteristic.ValveType.IRRIGATION;
    } else if (config.valveType === 'shower') {
      valveType = Characteristic.ValveType.SHOWER_HEAD;
    } else if (config.valveType === 'faucet') {
      valveType = Characteristic.ValveType.WATER_FAUCET;
    } else {
      valveType = Characteristic.ValveType.GENERIC_VALVE;
    }
  }
  service.setCharacteristic(Characteristic.ValveType, valveType);
}

// (upstream index.js:2526)
function linkIrrigationCharacteristics(thing: ThingContext, service: Service, valveSvc: Service, subIdx: number): void {
  const { config, hap, state } = thing;
  const { Characteristic } = hap;
  service.addLinkedService(valveSvc);
  const mainActive = service.getCharacteristic(Characteristic.Active)!;
  const mainInUse = service.getCharacteristic(Characteristic.InUse)!;
  const valveActive = valveSvc.getCharacteristic(Characteristic.Active)!;
  const valveInUse = valveSvc.getCharacteristic(Characteristic.InUse)!;

  // if valve is active, main service must also be active
  // if none of the valves is active, main service should be deactivated (except with config.noAutoInactive)
  valveActive.on('change', (obj) => {
    if (obj.newValue == Characteristic.Active.ACTIVE && !state.active) {
      state.active = true;
      mainActive.setValue(Characteristic.Active.ACTIVE, 'valve activated');
    } else if (obj.newValue == Characteristic.Active.INACTIVE && !config.noAutoInactive) {
      let mainActiveValue = false;
      for (const prop of state.activePropertyList as string[]) {
        if (state[prop]) {
          mainActiveValue = true;
          break;
        }
      }
      if (!mainActiveValue && state.active) {
        state.active = false;
        mainActive.setValue(Characteristic.Active.INACTIVE, 'all valves inactive');
      }
    }
  });

  // if main service is set to inactive, valves should also be inactive
  mainActive.on('change', (obj) => {
    if (obj.newValue == Characteristic.Active.INACTIVE && state['active-' + subIdx]) {
      state['active-' + subIdx] = false;
      valveActive.setValue(Characteristic.Active.INACTIVE, 'main off');
    }
  });

  // if valve is inUse, main service must also be inUse
  // if none of the valves is inUse, main service should not be inUse anymore
  valveInUse.on('change', (obj) => {
    if (obj.newValue == Characteristic.InUse.IN_USE && !state.inUse) {
      state.inUse = true;
      mainInUse.updateValue(Characteristic.InUse.IN_USE);
    } else if (obj.newValue == Characteristic.InUse.NOT_IN_USE) {
      let mainInUseValue = false;
      for (const prop of state.inUsePropertyList as string[]) {
        if (state[prop]) {
          mainInUseValue = true;
          break;
        }
      }
      if (!mainInUseValue && state.inUse) {
        state.inUse = false;
        mainInUse.updateValue(Characteristic.InUse.NOT_IN_USE);
      }
    }
  });
}

// irrigationSystem (upstream index.js:3422-3458)
registerServiceType('irrigationSystem', (thing) => {
  const { config, hap, log } = thing;
  const { Characteristic } = hap;

  // upstream quirk (index.js:3422): the dispatch chain tests config.type (not
  // the '-'-stripped configType), so subtyped 'irrigationSystem-*' configs
  // fall through to the unrecognized-type error - preserved for compatibility
  if (config.type != 'irrigationSystem') {
    log('ERROR: Unrecognized type: ' + config.type.split('-')[0]);
    return null;
  }

  const service = new hap.Service.IrrigationSystem(config.name, config.subtype);
  service.isPrimaryService = true;
  if (!config.topics) {
    config.topics = {};
  }
  characteristic_Active(thing, service);
  characteristic_InUse(thing, service);
  service.setCharacteristic(Characteristic.ProgramMode, Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED);
  if (config.topics.getStatusFault) {
    characteristic_StatusFault(thing, service);
  }

  const services: Service[] = [service];

  if (config.zones) {
    const zones = config.zones as SubServiceConfig[];
    const serviceLabel = new hap.Service.ServiceLabel();
    serviceLabel.setCharacteristic(Characteristic.ServiceLabelNamespace, Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
    services.push(serviceLabel);
    zones.forEach((zone, index) => {
      const zoneId = index + 1;
      const zoneName = zone.name || ''; // default name doesn't seem to work
      const valveSvc = new hap.Service.Valve(zoneName, String(zoneId));
      characteristic_ValveType(thing, valveSvc, Characteristic.ValveType.IRRIGATION);
      characteristic_ServiceLabelIndex(thing, valveSvc, zoneId);
      characteristic_Active(thing, valveSvc, zoneId, zone);
      characteristic_InUse(thing, valveSvc, zoneId, zone);
      characteristic_SetDuration(thing, valveSvc, zoneId, zone);
      characteristic_RemainingDuration(thing, valveSvc, zoneId, zone);
      valveSvc.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
      if (zone.topics.getStatusFault) {
        // upstream quirk: the condition tests the zone's getStatusFault topic,
        // but the characteristic is bound to the main config's topic
        characteristic_StatusFault(thing, valveSvc);
      }
      linkIrrigationCharacteristics(thing, service, valveSvc, zoneId); // valveSvc must be linked to main service
      services.push(valveSvc);
    });
  }
  return { service, services };
});
