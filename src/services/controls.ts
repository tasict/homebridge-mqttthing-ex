// Control characteristics shared by several ported accessory types
// (climate, fans, air quality, irrigation, television). Function names mirror
// upstream index.js (characteristic_*) so each port can be diffed against the
// original.
import type { Service } from 'homebridge';

import type { TopicSpec } from '../config.js';
import {
  addCharacteristic,
  booleanCharacteristic,
  integerCharacteristic,
  multiCharacteristic,
  setCharacteristic,
  type ThingContext,
} from '../hap/binding.js';

/** Per-zone (or other linked sub-service) config block, e.g. irrigation zones. */
export interface SubServiceConfig {
  name?: string;
  topics: {
    setActive?: TopicSpec;
    getActive?: TopicSpec;
    getInUse?: TopicSpec;
    setDuration?: TopicSpec;
    getDuration?: TopicSpec;
    getRemainingDuration?: TopicSpec;
    getStatusFault?: TopicSpec;
    [key: string]: TopicSpec | undefined;
  };
  [key: string]: unknown;
}

// Characteristic.Active (upstream index.js:2487)
export function characteristic_Active(thing: ThingContext, service: Service, subIdx?: number, subConfig?: SubServiceConfig): void {
  const { config, hap, state } = thing;
  let property_active = 'active';
  let topic_setActive = config.topics?.setActive;
  let topic_getActive = config.topics?.getActive;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_active = property_active + '-' + subIdx;
    topic_setActive = subConfig.topics.setActive;
    topic_getActive = subConfig.topics.getActive;
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
export function characteristic_InUse(thing: ThingContext, service: Service, subIdx?: number, subConfig?: SubServiceConfig): void {
  const { config, hap, state } = thing;
  let property_inUse = 'inUse';
  let topic_getInUse = config.topics?.getInUse;
  // for usage in linked sub-services:
  if (subIdx !== undefined && subIdx !== null && subConfig) {
    property_inUse = property_inUse + '-' + subIdx;
    topic_getInUse = subConfig.topics.getInUse;
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

// Characteristic.RotationDirection (upstream index.js:1993)
export function characteristic_RotationDirection(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(
    thing,
    service,
    'rotationDirection',
    hap.Characteristic.RotationDirection,
    config.topics?.setRotationDirection,
    config.topics?.getRotationDirection,
  );
}

// Characteristic.RotationSpeed (upstream index.js:1998)
export function characteristic_RotationSpeed(thing: ThingContext, service: Service, handleOn?: boolean): void {
  const { config, hap, state } = thing;

  if (config.topics?.setOn || !handleOn) {
    // separate On topic, or we're not handling 'On', so implement standard rotationSpeed characteristic
    integerCharacteristic(thing, service, 'rotationSpeed', hap.Characteristic.RotationSpeed, config.topics?.setRotationSpeed, config.topics?.getRotationSpeed, {
      minValue: config.minRotationSpeed as number | undefined,
      maxValue: config.maxRotationSpeed as number | undefined,
    });
  } else {
    // no separate On topic, so use RotationSpeed 0 to indicate Off state...

    // subscription
    if (config.topics?.getRotationSpeed) {
      thing.subscribe(config.topics.getRotationSpeed, 'rotationSpeed', (_topic, message) => {
        const newState = parseInt(String(message));
        const newOn = newState != 0;
        if (state.rotationSpeed != newState || state.on != newOn) {
          if (newOn) {
            state.rotationSpeed = newState;
            setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.RotationSpeed)!, newState);
          }
          state.on = newOn;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.On)!, newState != 0);
        }
      });
    }

    // publishing (throttled)
    const publishNow = () => {
      let rot = state.rotationSpeed;
      if (!config.topics?.setOn && !state.on) {
        rot = 0;
      }
      thing.publish(config.topics?.setRotationSpeed, 'rotationSpeed', rot);
    };

    const publish = () => thing.throttledCall(publishNow, 'rotationSpeed_pub', 20);

    // RotationSpeed characteristic
    addCharacteristic(thing, service, 'rotationSpeed', hap.Characteristic.RotationSpeed, 0, () => {
      if ((state.rotationSpeed as number) > 0 && !state.on) {
        state.on = true;
      }
      publish();
    });

    // On Characteristic
    addCharacteristic(thing, service, 'on', hap.Characteristic.On, false, () => {
      if (state.on && state.rotationSpeed == 0) {
        state.rotationSpeed = 100;
      }
      publish();
    });
  }
}

// Characteristic.LockPhysicalControls (upstream index.js:2353)
export function characteristic_LockPhysicalControls(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.lockPhysicalControlsValues as unknown[] | undefined;
  if (!values) {
    values = ['DISABLED', 'ENABLED'];
  }
  multiCharacteristic(
    thing,
    service,
    'lockPhysicalControls',
    hap.Characteristic.LockPhysicalControls,
    config.topics?.setLockPhysicalControls,
    config.topics?.getLockPhysicalControls,
    values,
    hap.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED,
  );
}

// Characteristic.SwingMode (upstream index.js:2362)
export function characteristic_SwingMode(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.swingModeValues as unknown[] | undefined;
  if (!values) {
    values = ['DISABLED', 'ENABLED'];
  }
  multiCharacteristic(
    thing,
    service,
    'swingMode',
    hap.Characteristic.SwingMode,
    config.topics?.setSwingMode,
    config.topics?.getSwingMode,
    values,
    hap.Characteristic.SwingMode.SWING_DISABLED,
  );
}

// Characteristic.TemperatureDisplayUnits (upstream index.js:2371)
export function characteristic_TemperatureDisplayUnits(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.temperatureDisplayUnitsValues as unknown[] | undefined;
  if (!values) {
    values = ['CELSIUS', 'FAHRENHEIT'];
  }
  multiCharacteristic(
    thing,
    service,
    'temperatureDisplayUnits',
    hap.Characteristic.TemperatureDisplayUnits,
    config.topics?.setTemperatureDisplayUnits,
    config.topics?.getTemperatureDisplayUnits,
    values,
    hap.Characteristic.TemperatureDisplayUnits.CELSIUS,
  );
}
