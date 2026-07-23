// securitySystem accessory type.
// Ported from upstream index.js dispatch branch (3107-3120).
import type { Service } from 'homebridge';

import { multiCharacteristic, type ThingContext } from '../hap/binding.js';
import { registerServiceType } from './registry.js';
import {
  characteristic_AltSensorState,
  characteristic_StatusFault,
  characteristic_StatusTampered,
} from './shared.js';

// Characteristic.SecuritySystemCurrentState (upstream index.js:1864)
export function characteristic_SecuritySystemCurrentState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.currentStateValues as unknown[] | undefined;
  if (!values) {
    values = ['SA', 'AA', 'NA', 'D', 'T'];
  }
  multiCharacteristic(thing, service, 'currentState', hap.Characteristic.SecuritySystemCurrentState, undefined, config.topics?.getCurrentState, values, hap.Characteristic.SecuritySystemCurrentState.DISARMED);
}

// Characteristic.SecuritySystemTargetState (upstream index.js:1873)
export function characteristic_SecuritySystemTargetState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.targetStateValues as unknown[] | undefined;
  if (!values) {
    values = ['SA', 'AA', 'NA', 'D'];
  }
  multiCharacteristic(thing, service, 'targetState', hap.Characteristic.SecuritySystemTargetState, config.topics?.setTargetState, config.topics?.getTargetState, values, hap.Characteristic.SecuritySystemTargetState.DISARM);
  if (config.restrictTargetState) {
    const characteristic = service.getCharacteristic(hap.Characteristic.SecuritySystemTargetState)!;
    characteristic.props.validValues = config.restrictTargetState as number[];
  }
}

// securitySystem (upstream index.js:3107-3120)
registerServiceType('securitySystem', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.SecuritySystem(config.name, config.subtype);
  characteristic_SecuritySystemTargetState(thing, service);
  characteristic_SecuritySystemCurrentState(thing, service);
  if (config.topics?.getStatusFault) {
    characteristic_StatusFault(thing, service);
  }
  if (config.topics?.getStatusTampered) {
    characteristic_StatusTampered(thing, service);
  }
  if (config.topics?.getAltSensorState) {
    characteristic_AltSensorState(thing);
  }
  // todo: SecuritySystemAlarmType (upstream index.js:3120)
  return { service };
});
