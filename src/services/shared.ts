// Shared characteristic wrappers used across accessory types. Function names
// mirror upstream index.js (characteristic_*) so each port can be diffed
// against the original.
import type { Service } from 'homebridge';

import {
  booleanCharacteristic,
  floatCharacteristic,
  integerCharacteristic,
  multiCharacteristic,
  stringCharacteristic,
  type ThingContext,
  type CharacteristicSelector,
} from '../hap/binding.js';
import { isRecvValueOff, isRecvValueOn } from '../hap/values.js';

// Fallback warning for accessory types without history support (real history
// lives in src/features/history.ts). No longer used by the built-in types.
export function historyNotYetAvailable(thing: ThingContext): void {
  if (thing.config.history) {
    thing.log.warn('History is not supported by this version yet - continuing without history');
  }
}

// Characteristic.On (upstream index.js:1329)
export function characteristic_On(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'on', hap.Characteristic.On, config.topics?.setOn, config.topics?.getOn, {
    turnOffAfterms: config.turnOffAfterms as number | undefined,
    resetStateAfterms: config.resetStateAfterms as number | undefined,
    enableConfirmation: true,
  });
}

// Characteristic.Name (upstream index.js:1465)
export function characteristic_Name(thing: ThingContext, service: Service): void {
  stringCharacteristic(thing, service, 'name', thing.hap.Characteristic.Name, undefined, thing.config.topics?.getName, thing.config.name);
}

// Characteristic.OutletInUse (upstream index.js:1460)
export function characteristic_OutletInUse(thing: ThingContext, service: Service): void {
  booleanCharacteristic(thing, service, 'outletInUse', thing.hap.Characteristic.OutletInUse, undefined, thing.config.topics?.getInUse);
}

// Characteristic.MotionDetected (upstream index.js:1470)
export function characteristic_MotionDetected(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'motionDetected', hap.Characteristic.MotionDetected, undefined, config.topics?.getMotionDetected, {
    resetStateAfterms: config.turnOffAfterms as number | undefined,
  });
}

// Characteristic.StatusActive (upstream index.js:1535)
export function characteristic_StatusActive(thing: ThingContext, service: Service): void {
  booleanCharacteristic(thing, service, 'statusActive', thing.hap.Characteristic.StatusActive, undefined, thing.config.topics?.getStatusActive, {
    initialValue: true,
  });
}

// Characteristic.StatusFault (upstream index.js:1540)
export function characteristic_StatusFault(thing: ThingContext, service: Service): void {
  booleanCharacteristic(thing, service, 'statusFault', thing.hap.Characteristic.StatusFault, undefined, thing.config.topics?.getStatusFault);
}

// Characteristic.StatusTampered (upstream index.js:1545)
export function characteristic_StatusTampered(thing: ThingContext, service: Service): void {
  const { hap } = thing;
  // F9 (upstream #631): StatusTampered is UINT8 in HAP; emit 0/1 instead of
  // booleans (truthy MQTT value mappings are unchanged)
  booleanCharacteristic(thing, service, 'statusTampered', hap.Characteristic.StatusTampered, undefined, thing.config.topics?.getStatusTampered, {
    mapValueFunc: (val) =>
      val ? hap.Characteristic.StatusTampered.TAMPERED : hap.Characteristic.StatusTampered.NOT_TAMPERED,
  });
}

// Characteristic.AltSensorState (upstream index.js:1550)
export function characteristic_AltSensorState(thing: ThingContext): void {
  const { config, log } = thing;
  thing.subscribe(config.topics!.getAltSensorState!, 'AltSensorState', (_topic, message) => {
    // determine whether this is an on or off value
    let newState = false; // assume off
    if (isRecvValueOn(config, message)) {
      newState = true; // received on value so on
    } else if (!isRecvValueOff(config, message)) {
      // received value NOT acceptable as 'off' so ignore message
      return;
    }
    log.warn(`AltSensorState now ${newState ? 'on' : 'off'} - TODO: update state and set characteristic??`);
  });
}

// Characteristic.StatusLowBattery (upstream index.js:1577)
export function characteristic_StatusLowBattery(thing: ThingContext, service: Service): void {
  booleanCharacteristic(thing, service, 'statusLowBattery', thing.hap.Characteristic.StatusLowBattery, undefined, thing.config.topics?.getStatusLowBattery);
}

// Characteristic.OccupancyDetected (upstream index.js:1582)
export function characteristic_OccupancyDetected(thing: ThingContext, service: Service): void {
  const { hap } = thing;
  booleanCharacteristic(thing, service, 'occupancyDetected', hap.Characteristic.OccupancyDetected, undefined, thing.config.topics?.getOccupancyDetected, {
    initialValue: false,
    mapValueFunc: (val) =>
      val
        ? hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
  });
}

// Characteristic.CurrentAmbientLightLevel (upstream index.js:1589)
export function characteristic_CurrentAmbientLightLevel(thing: ThingContext, service: Service): void {
  floatCharacteristic(
    thing,
    service,
    'currentAmbientLightLevel',
    thing.hap.Characteristic.CurrentAmbientLightLevel,
    undefined,
    thing.config.topics?.getCurrentAmbientLightLevel,
    0.0001,
  );
}

// Configured temperature range helper (upstream index.js:1621-1634).
export function tempRange(thing: ThingContext, service: Service, theCharacteristic: CharacteristicSelector): boolean {
  const { config } = thing;
  let customRangeSet = false;
  if (config.minTemperature !== undefined || config.maxTemperature !== undefined) {
    customRangeSet = true;
    const characteristic = service.getCharacteristic(theCharacteristic)!;
    const props: { minValue?: number; maxValue?: number } = {};
    if (config.minTemperature !== undefined) {
      props.minValue = config.minTemperature as number;
    }
    if (config.maxTemperature !== undefined) {
      props.maxValue = config.maxTemperature as number;
    }
    try {
      characteristic.setProps(props);
    } catch (ex) {
      thing.log.warn(`Ignoring invalid temperature range ${JSON.stringify(props)} - ${ex}`);
    }
  }
  return customRangeSet;
}

// Characteristic.CurrentTemperature (upstream index.js:1595)
export function characteristic_CurrentTemperature(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'currentTemperature', hap.Characteristic.CurrentTemperature, undefined, config.topics?.getCurrentTemperature, 0);

  // F3 (upstream #587, #592, #392): minTemperature/maxTemperature describe
  // the settable Target/Threshold range; upstream also clamped
  // CurrentTemperature with them, invalidating real sensor readings. The
  // configured range may only WIDEN the current-temperature range beyond the
  // wide default of -100..100.
  const minConfigured = Number(config.minTemperature);
  const maxConfigured = Number(config.maxTemperature);
  service.getCharacteristic(hap.Characteristic.CurrentTemperature).setProps({
    minValue: Math.min(Number.isFinite(minConfigured) ? minConfigured : -100, -100),
    maxValue: Math.max(Number.isFinite(maxConfigured) ? maxConfigured : 100, 100),
  });
}

// Characteristic.CurrentRelativeHumidity (upstream index.js:1667)
export function characteristic_CurrentRelativeHumidity(thing: ThingContext, service: Service): void {
  floatCharacteristic(
    thing,
    service,
    'currentRelativeHumidity',
    thing.hap.Characteristic.CurrentRelativeHumidity,
    undefined,
    thing.config.topics?.getCurrentRelativeHumidity,
    0,
  );
}

// Eve.Characteristics.AirPressure (upstream index.js:1693)
export function characteristic_AirPressure(thing: ThingContext, service: Service): void {
  floatCharacteristic(thing, service, 'airPressure', thing.eve.Characteristics.AirPressure, undefined, thing.config.topics?.getAirPressure, 700);
  // set characteristic Elevation for air pressure calibration (not used yet with MQTT)
  service.updateCharacteristic(thing.eve.Characteristics.Elevation, 100);
}

// Characteristic.BatteryLevel (upstream index.js:2053)
export function characteristic_BatteryLevel(thing: ThingContext, service: Service): void {
  integerCharacteristic(thing, service, 'batteryLevel', thing.hap.Characteristic.BatteryLevel, undefined, thing.config.topics?.getBatteryLevel);
}

// Characteristic.ChargingState (upstream index.js:2058)
export function characteristic_ChargingState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.chargingStateValues as unknown[] | undefined;
  if (!values) {
    values = ['NOT_CHARGING', 'CHARGING', 'NOT_CHARGEABLE'];
  }
  multiCharacteristic(
    thing,
    service,
    'chargingState',
    hap.Characteristic.ChargingState,
    undefined,
    config.topics?.getChargingState,
    values,
    hap.Characteristic.ChargingState.NOT_CHARGING,
  );
}

// Characteristic.LeakDetected (upstream index.js:2067)
export function characteristic_LeakDetected(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  booleanCharacteristic(thing, service, 'leakDetected', hap.Characteristic.LeakDetected, undefined, config.topics?.getLeakDetected, {
    initialValue: false,
    mapValueFunc: (val) =>
      val ? hap.Characteristic.LeakDetected.LEAK_DETECTED : hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    resetStateAfterms: config.resetStateAfterms as number | undefined,
  });
}

// Eve.Characteristics.CurrentConsumption [Watts] (upstream index.js:2398)
export function characteristic_CurrentConsumption(thing: ThingContext, service: Service): void {
  service.addOptionalCharacteristic(thing.eve.Characteristics.CurrentConsumption); // to avoid warnings
  floatCharacteristic(thing, service, 'currentConsumption', thing.eve.Characteristics.CurrentConsumption, undefined, thing.config.topics?.getWatts, 0);
}

// Eve.Characteristics.Voltage [Volts] (upstream index.js:2404)
export function characteristic_Voltage(thing: ThingContext, service: Service): void {
  service.addOptionalCharacteristic(thing.eve.Characteristics.Voltage); // to avoid warnings
  floatCharacteristic(thing, service, 'voltage', thing.eve.Characteristics.Voltage, undefined, thing.config.topics?.getVolts, {
    minValue: thing.config.minVolts as number | undefined,
    maxValue: thing.config.maxVolts as number | undefined,
  });
}

// Eve.Characteristics.ElectricCurrent [Amperes] (upstream index.js:2412)
export function characteristic_ElectricCurrent(thing: ThingContext, service: Service): void {
  service.addOptionalCharacteristic(thing.eve.Characteristics.ElectricCurrent); // to avoid warnings
  floatCharacteristic(thing, service, 'electricCurrent', thing.eve.Characteristics.ElectricCurrent, undefined, thing.config.topics?.getAmperes, 0);
}

// Eve.Characteristics.TotalConsumption [kWh] (upstream index.js:2418)
export function characteristic_TotalConsumption(thing: ThingContext, service: Service): void {
  service.addOptionalCharacteristic(thing.eve.Characteristics.TotalConsumption); // to avoid warnings
  floatCharacteristic(thing, service, 'totalConsumption', thing.eve.Characteristics.TotalConsumption, undefined, thing.config.topics?.getTotalConsumption, 0);
}

// Sensor optional characteristics (upstream index.js:2793)
export function addSensorOptionalCharacteristics(thing: ThingContext, service: Service): void {
  const { config } = thing;
  if (config.topics?.getStatusActive) {
    characteristic_StatusActive(thing, service);
  }
  if (config.topics?.getStatusFault) {
    characteristic_StatusFault(thing, service);
  }
  if (config.topics?.getStatusTampered) {
    characteristic_StatusTampered(thing, service);
  }
  if (config.topics?.getStatusLowBattery) {
    characteristic_StatusLowBattery(thing, service);
  }
}

// Battery characteristics (upstream index.js:2809)
export function addBatteryCharacteristics(thing: ThingContext, service: Service): void {
  const { config } = thing;
  if (config.topics?.getBatteryLevel) {
    characteristic_BatteryLevel(thing, service);
  }
  if (config.topics?.getChargingState) {
    characteristic_ChargingState(thing, service);
  }
  if (config.topics?.getStatusLowBattery) {
    characteristic_StatusLowBattery(thing, service);
  }
}
