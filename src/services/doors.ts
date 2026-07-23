// Door-ish accessory types: garageDoorOpener, lockMechanism, windowCovering,
// window, door. Ported from upstream index.js dispatch branches (3125-3147,
// 3178-3222).
import type { Service } from 'homebridge';

import {
  booleanCharacteristic,
  integerCharacteristic,
  multiCharacteristic,
  setCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import { isRecvValueOff, isRecvValueOn } from '../hap/values.js';
import type { TopicSpec } from '../config.js';
import { registerServiceType } from './registry.js';

// Characteristic.CurrentDoorState (upstream index.js:1893)
export function characteristic_CurrentDoorState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = (config.doorCurrentValues || config.doorValues) as unknown[] | undefined;
  if (!values) {
    values = ['O', 'C', 'o', 'c', 'S'];
  }
  multiCharacteristic(thing, service, 'currentDoorState', hap.Characteristic.CurrentDoorState, undefined, config.topics?.getCurrentDoorState, values, hap.Characteristic.CurrentDoorState.CLOSED);
}

// upstream index.js:1902
function characteristic_SimpleCurrentDoorState(
  thing: ThingContext,
  service: Service,
  property: string,
  getTopic: TopicSpec | undefined,
  initialValue: boolean,
  mapValueFunc: (value: unknown) => number,
): void {
  const { config, state, events, hap } = thing;

  // set up characteristic
  const charac = service.getCharacteristic(hap.Characteristic.CurrentDoorState)!;
  charac.onGet(() => {
    if (thing.isOffline()) {
      throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return mapValueFunc(state[property]);
  });

  // property-changed handler
  const propChangedHandler = (events.targetDoorState = () => {
    setTimeout(() => {
      setCharacteristic(thing, charac, mapValueFunc(state[property]));
    }, 1000);
  });

  // set initial value
  state[property] = initialValue;
  propChangedHandler();

  // subscribe to get topic
  if (getTopic) {
    thing.subscribe(getTopic, property, (_topic, message) => {
      // determine whether this is an on or off value
      let newState = false; // assume off
      if (isRecvValueOn(config, message)) {
        newState = true; // received on value so on
      } else if (!isRecvValueOff(config, message)) {
        // received value NOT acceptable as 'off' so ignore message
        return;
      }

      // if changed, set
      if (state[property] != newState) {
        state[property] = newState;
        propChangedHandler();
      }
    });
  }
}

// Characteristic.DoorMoving (mqttthing simplified state) (upstream index.js:1942)
export function characteristic_DoorMoving(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;
  characteristic_SimpleCurrentDoorState(thing, service, 'doorMoving', config.topics?.getDoorMoving, false, (isMoving) => {
    if (isMoving) {
      if (state.targetDoorState == hap.Characteristic.TargetDoorState.OPEN) {
        return hap.Characteristic.CurrentDoorState.OPENING;
      } else {
        return hap.Characteristic.CurrentDoorState.CLOSING;
      }
    } else {
      if (state.targetDoorState == hap.Characteristic.TargetDoorState.OPEN) {
        return hap.Characteristic.CurrentDoorState.OPEN;
      } else {
        return hap.Characteristic.CurrentDoorState.CLOSED;
      }
    }
  });
}

// Characteristic.TargetDoorState (upstream index.js:1961)
export function characteristic_TargetDoorState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = (config.doorTargetValues || config.doorValues) as unknown[] | undefined;
  if (!values) {
    values = ['O', 'C'];
  }
  multiCharacteristic(thing, service, 'targetDoorState', hap.Characteristic.TargetDoorState, config.topics?.setTargetDoorState, config.topics?.getTargetDoorState, values, hap.Characteristic.TargetDoorState.OPEN);
}

// Characteristic.ObstructionDetected (upstream index.js:1970)
export function characteristic_ObstructionDetected(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'obstructionDetected', hap.Characteristic.ObstructionDetected, undefined, config.topics?.getObstructionDetected);
}

// Characteristic.LockCurrentState (upstream index.js:1975)
export function characteristic_LockCurrentState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.lockValues as unknown[] | undefined;
  if (!values) {
    values = ['U', 'S', 'J', '?'];
  }
  multiCharacteristic(thing, service, 'lockCurrentState', hap.Characteristic.LockCurrentState, undefined, config.topics?.getLockCurrentState, values, hap.Characteristic.LockCurrentState.UNSECURED);
}

// Characteristic.LockTargetState (upstream index.js:1984)
export function characteristic_LockTargetState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.lockValues as unknown[] | undefined;
  if (!values) {
    values = ['U', 'S'];
  }
  multiCharacteristic(thing, service, 'lockTargetState', hap.Characteristic.LockTargetState, config.topics?.setLockTargetState, config.topics?.getLockTargetState, values, hap.Characteristic.LockTargetState.UNSECURED);
}

// Characteristic.TargetPosition (upstream index.js:2080)
export function characteristic_TargetPosition(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(thing, service, 'targetPosition', hap.Characteristic.TargetPosition, config.topics?.setTargetPosition, config.topics?.getTargetPosition, {
    initialValue: (config.minPosition as number | undefined) || 0,
    minValue: config.minPosition as number | undefined,
    maxValue: config.maxPosition as number | undefined,
  });
}

// Characteristic.CurrentPosition (upstream index.js:2089)
export function characteristic_CurrentPosition(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(thing, service, 'currentPosition', hap.Characteristic.CurrentPosition, undefined, config.topics?.getCurrentPosition, {
    initialValue: (config.minPosition as number | undefined) || 0,
    minValue: config.minPosition as number | undefined,
    maxValue: config.maxPosition as number | undefined,
  });
}

// Characteristic.PositionState (upstream index.js:2098)
export function characteristic_PositionState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.positionStateValues as unknown[] | undefined;
  if (!values) {
    values = ['DECREASING', 'INCREASING', 'STOPPED'];
  }
  multiCharacteristic(thing, service, 'positionState', hap.Characteristic.PositionState, undefined, config.topics?.getPositionState, values, hap.Characteristic.PositionState.STOPPED);
}

// Characteristic.HoldPosition (upstream index.js:2107)
export function characteristic_HoldPosition(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'holdPosition', hap.Characteristic.HoldPosition, config.topics?.setHoldPosition, undefined);
}

// Characteristic.TargetHorizontalTiltAngle
// (upstream index.js:2112 - named Characteristic_TargetHorizontalTiltAngle
// with a capital C upstream; behavior identical)
export function characteristic_TargetHorizontalTiltAngle(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(thing, service, 'targetHorizontalTiltAngle', hap.Characteristic.TargetHorizontalTiltAngle, config.topics?.setTargetHorizontalTiltAngle, config.topics?.getTargetHorizontalTiltAngle);
}

// Characteristic.CurrentHorizontalTiltAngle (upstream index.js:2117)
export function characteristic_CurrentHorizontalTiltAngle(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(thing, service, 'currentHorizontalTiltAngle', hap.Characteristic.CurrentHorizontalTiltAngle, undefined, config.topics?.getCurrentHorizontalTiltAngle);
}

// Characteristic.TargetVerticalTiltAngle (upstream index.js:2122)
export function characteristic_TargetVerticalTiltAngle(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(thing, service, 'targetVerticalTiltAngle', hap.Characteristic.TargetVerticalTiltAngle, config.topics?.setTargetVerticalTiltAngle, config.topics?.getTargetVerticalTiltAngle);
}

// Characteristic.CurrentVerticalTiltAngle (upstream index.js:2127)
export function characteristic_CurrentVerticalTiltAngle(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  integerCharacteristic(thing, service, 'currentVerticalTiltAngle', hap.Characteristic.CurrentVerticalTiltAngle, undefined, config.topics?.getCurrentVerticalTiltAngle);
}

// garageDoorOpener (upstream index.js:3125-3139)
registerServiceType('garageDoorOpener', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.GarageDoorOpener(config.name, config.subtype);
  characteristic_TargetDoorState(thing, service);
  if (config.topics?.getDoorMoving) {
    characteristic_DoorMoving(thing, service);
  } else {
    characteristic_CurrentDoorState(thing, service);
  }
  characteristic_ObstructionDetected(thing, service);
  if (config.topics?.setLockTargetState) {
    characteristic_LockTargetState(thing, service);
  }
  if (config.topics?.getLockCurrentState) {
    characteristic_LockCurrentState(thing, service);
  }
  return { service };
});

// lockMechanism (upstream index.js:3140-3147)
registerServiceType('lockMechanism', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.LockMechanism(config.name, config.subtype);
  if (config.topics?.setLockTargetState) {
    characteristic_LockTargetState(thing, service);
  }
  if (config.topics?.getLockCurrentState) {
    characteristic_LockCurrentState(thing, service);
  }
  return { service };
});

// windowCovering (upstream index.js:3178-3200)
registerServiceType('windowCovering', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.WindowCovering(config.name, config.subtype);
  characteristic_CurrentPosition(thing, service);
  characteristic_TargetPosition(thing, service);
  characteristic_PositionState(thing, service);
  if (config.topics?.setHoldPosition) {
    characteristic_HoldPosition(thing, service);
  }
  if (config.topics?.getTargetHorizontalTiltAngle || config.topics?.setTargetHorizontalTiltAngle) {
    characteristic_TargetHorizontalTiltAngle(thing, service);
  }
  if (config.topics?.getTargetVerticalTiltAngle || config.topics?.setTargetVerticalTiltAngle) {
    characteristic_TargetVerticalTiltAngle(thing, service);
  }
  if (config.topics?.getCurrentHorizontalTiltAngle) {
    characteristic_CurrentHorizontalTiltAngle(thing, service);
  }
  if (config.topics?.getCurrentVerticalTiltAngle) {
    characteristic_CurrentVerticalTiltAngle(thing, service);
  }
  if (config.topics?.getObstructionDetected) {
    characteristic_ObstructionDetected(thing, service);
  }
  return { service };
});

// window (upstream index.js:3201-3211)
registerServiceType('window', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Window(config.name, config.subtype);
  characteristic_CurrentPosition(thing, service);
  characteristic_TargetPosition(thing, service);
  characteristic_PositionState(thing, service);
  if (config.topics?.setHoldPosition) {
    characteristic_HoldPosition(thing, service);
  }
  if (config.topics?.getObstructionDetected) {
    characteristic_ObstructionDetected(thing, service);
  }
  return { service };
});

// door (upstream index.js:3212-3222)
registerServiceType('door', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Door(config.name, config.subtype);
  characteristic_CurrentPosition(thing, service);
  characteristic_TargetPosition(thing, service);
  characteristic_PositionState(thing, service);
  if (config.topics?.setHoldPosition) {
    characteristic_HoldPosition(thing, service);
  }
  if (config.topics?.getObstructionDetected) {
    characteristic_ObstructionDetected(thing, service);
  }
  return { service };
});
