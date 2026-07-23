// Climate accessory types: thermostat, heaterCooler, dehumidifier.
// Ported from upstream index.js dispatch branches (3315-3364, 3054-3067).
import type { Service } from 'homebridge';

import {
  floatCharacteristic,
  integerCharacteristic,
  multiCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import {
  characteristic_Active,
  characteristic_LockPhysicalControls,
  characteristic_RotationSpeed,
  characteristic_SwingMode,
  characteristic_TemperatureDisplayUnits,
} from './controls.js';
import { registerServiceType } from './registry.js';
import {
  characteristic_CurrentRelativeHumidity,
  characteristic_CurrentTemperature,
  characteristic_StatusFault,
  tempRange,
} from './shared.js';

// Characteristic.TargetTemperature (upstream index.js:1637)
function characteristic_TargetTemperature(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(
    thing,
    service,
    'targetTemperature',
    hap.Characteristic.TargetTemperature,
    config.topics?.setTargetTemperature,
    config.topics?.getTargetTemperature,
    10,
  );

  // custom min/max
  tempRange(thing, service, hap.Characteristic.TargetTemperature);
}

// Characteristic.CoolingThresholdTemperature (upstream index.js:1646)
function characteristic_CoolingThresholdTemperature(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(
    thing,
    service,
    'coolingThresholdTemperature',
    hap.Characteristic.CoolingThresholdTemperature,
    config.topics?.setCoolingThresholdTemperature,
    config.topics?.getCoolingThresholdTemperature,
    25,
  );

  tempRange(thing, service, hap.Characteristic.CoolingThresholdTemperature);
}

// Characteristic.RelativeHumidityDehumidifierThreshold (upstream index.js:1654)
function characteristic_RelativeHumidityDehumidifierThreshold(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(
    thing,
    service,
    'relativeHumidityDehumidifierThreshold',
    hap.Characteristic.RelativeHumidityDehumidifierThreshold,
    config.topics?.setRelativeHumidityDehumidifierThreshold,
    config.topics?.getRelativeHumidityDehumidifierThreshold,
    0,
  );
}

// Characteristic.HeatingThresholdTemperature (upstream index.js:1659)
function characteristic_HeatingThresholdTemperature(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(
    thing,
    service,
    'heatingThresholdTemperature',
    hap.Characteristic.HeatingThresholdTemperature,
    config.topics?.setHeatingThresholdTemperature,
    config.topics?.getHeatingThresholdTemperature,
    20,
  );

  tempRange(thing, service, hap.Characteristic.HeatingThresholdTemperature);
}

// Characteristic.TargetRelativeHumidity (upstream index.js:1673)
function characteristic_TargetRelativeHumidity(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(
    thing,
    service,
    'targetRelativeHumidity',
    hap.Characteristic.TargetRelativeHumidity,
    config.topics?.setTargetRelativeHumidity,
    config.topics?.getTargetRelativeHumidity,
    0,
  );
}

// Characteristic.WaterLevel (upstream index.js:2074)
function characteristic_WaterLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  const options = { minValue: 0, maxValue: 100 };
  integerCharacteristic(thing, service, 'waterLevel', hap.Characteristic.WaterLevel, config.topics?.setWaterLevel, config.topics?.getWaterLevel, options);
}

// Characteristic.CurrentHeatingCoolingState (upstream index.js:2252)
function characteristic_CurrentHeatingCoolingState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.heatingCoolingStateValues as unknown[] | undefined;
  if (!values) {
    values = ['OFF', 'HEAT', 'COOL'];
  }
  multiCharacteristic(
    thing,
    service,
    'currentHeatingCoolingState',
    hap.Characteristic.CurrentHeatingCoolingState,
    undefined,
    config.topics?.getCurrentHeatingCoolingState,
    values,
    hap.Characteristic.CurrentHeatingCoolingState.OFF,
  );
}

// Characteristic.TargetHeatingCoolingState (upstream index.js:2261)
function characteristic_TargetHeatingCoolingState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.heatingCoolingStateValues as unknown[] | undefined;
  if (!values) {
    values = ['OFF', 'HEAT', 'COOL', 'AUTO'];
  }
  multiCharacteristic(
    thing,
    service,
    'targetHeatingCoolingState',
    hap.Characteristic.TargetHeatingCoolingState,
    config.topics?.setTargetHeatingCoolingState,
    config.topics?.getTargetHeatingCoolingState,
    values,
    hap.Characteristic.TargetHeatingCoolingState.OFF,
  );
  if (config.restrictHeatingCoolingState) {
    const characteristic = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)!;
    try {
      characteristic.setProps({ validValues: config.restrictHeatingCoolingState as number[] });
    } catch (ex) {
      thing.log.warn(`Ignoring invalid restrictHeatingCoolingState ${JSON.stringify(config.restrictHeatingCoolingState)} - ${ex}`);
    }
  }
}

// Characteristic.CurrentHeaterCoolerState (upstream index.js:2274)
function characteristic_CurrentHeaterCoolerState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.currentHeaterCoolerValues as unknown[] | undefined;
  if (!values) {
    values = ['INACTIVE', 'IDLE', 'HEATING', 'COOLING'];
  }
  multiCharacteristic(
    thing,
    service,
    'currentHeaterCoolerState',
    hap.Characteristic.CurrentHeaterCoolerState,
    undefined,
    config.topics?.getCurrentHeaterCoolerState,
    values,
    hap.Characteristic.CurrentHeaterCoolerState.INACTIVE,
  );
}

// Characteristic.TargetHeaterCoolerState (upstream index.js:2283)
function characteristic_TargetHeaterCoolerState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.targetHeaterCoolerValues as unknown[] | undefined;
  if (!values) {
    values = ['AUTO', 'HEAT', 'COOL'];
  }
  multiCharacteristic(
    thing,
    service,
    'targetHeaterCoolerState',
    hap.Characteristic.TargetHeaterCoolerState,
    config.topics?.setTargetHeaterCoolerState,
    config.topics?.getTargetHeaterCoolerState,
    values,
    hap.Characteristic.TargetHeaterCoolerState.AUTO,
  );
  if (config.restrictHeaterCoolerState) {
    const characteristic = service.getCharacteristic(hap.Characteristic.TargetHeaterCoolerState)!;
    try {
      characteristic.setProps({ validValues: config.restrictHeaterCoolerState as number[] });
    } catch (ex) {
      thing.log.warn(`Ignoring invalid restrictHeaterCoolerState ${JSON.stringify(config.restrictHeaterCoolerState)} - ${ex}`);
    }
  }
}

// Characteristic.TargetHumidifierDehumidifierState (upstream index.js:2296)
function characteristic_TargetHumidifierDehumidifierState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.targetHumidifierDehumidifierState as unknown[] | undefined;
  if (!values) {
    values = ['HUMIDIFIER_OR_DEHUMIDIFIER', 'HUMIDIFIER', 'DEHUMIDIFIER'];
  }
  multiCharacteristic(
    thing,
    service,
    'targetHumidifierDehumidifierState',
    hap.Characteristic.TargetHumidifierDehumidifierState,
    config.topics?.setTargetHumidifierDehumidifierState,
    config.topics?.getTargetHumidifierDehumidifierState,
    values,
    hap.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER,
  );
  if (config.restrictDehumidifierState) {
    // upstream quirk (index.js:2302-2305): references the non-existent
    // Characteristic.TargetDehumidifierState, so configuring
    // restrictDehumidifierState throws - preserved for compatibility
    const characteristic = service.getCharacteristic(
      (hap.Characteristic as unknown as Record<string, never>).TargetDehumidifierState,
    )!;
    (characteristic.props as { validValues?: unknown }).validValues = config.restrictDehumidifierState;
  }
}

// Characteristic.CurrentHumidifierDehumidifierState (upstream index.js:2309)
function characteristic_CurrentHumidifierDehumidifierState(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.currentHumidifierDehumidifierState as unknown[] | undefined;
  if (!values) {
    values = ['INACTIVE', 'IDLE', 'HUMIDIFYING', 'DEHUMIDIFYING'];
  }
  multiCharacteristic(
    thing,
    service,
    'currentHumidifierDehumidifierState',
    hap.Characteristic.CurrentHumidifierDehumidifierState,
    undefined,
    config.topics?.getCurrentHumidifierDehumidifierState,
    values,
    hap.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE,
  );
}

// thermostat (upstream index.js:3315-3337)
registerServiceType('thermostat', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Thermostat(config.name, config.subtype);
  characteristic_Active(thing, service);
  characteristic_CurrentHeatingCoolingState(thing, service);
  characteristic_TargetHeatingCoolingState(thing, service);
  characteristic_CurrentTemperature(thing, service);
  characteristic_TargetTemperature(thing, service);
  characteristic_TemperatureDisplayUnits(thing, service);
  if (config.topics?.getCurrentRelativeHumidity) {
    characteristic_CurrentRelativeHumidity(thing, service);
  }
  if (config.topics?.getTargetRelativeHumidity || config.topics?.setTargetRelativeHumidity) {
    characteristic_TargetRelativeHumidity(thing, service);
  }
  if (config.topics?.getCoolingThresholdTemperature || config.topics?.setCoolingThresholdTemperature) {
    characteristic_CoolingThresholdTemperature(thing, service);
  }
  if (config.topics?.getHeatingThresholdTemperature || config.topics?.setHeatingThresholdTemperature) {
    characteristic_HeatingThresholdTemperature(thing, service);
  }
  if (config.topics?.getStatusFault) {
    characteristic_StatusFault(thing, service);
  }
  return { service };
});

// heaterCooler (upstream index.js:3338-3364)
registerServiceType('heaterCooler', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.HeaterCooler(config.name, config.subtype);
  characteristic_Active(thing, service);
  characteristic_CurrentHeaterCoolerState(thing, service);
  characteristic_TargetHeaterCoolerState(thing, service);
  characteristic_CurrentTemperature(thing, service);
  if (config.topics?.setLockPhysicalControls || config.topics?.getLockPhysicalControls) {
    characteristic_LockPhysicalControls(thing, service);
  }
  if (config.topics?.getSwingMode || config.topics?.setSwingMode) {
    characteristic_SwingMode(thing, service);
  }
  if (config.topics?.getCoolingThresholdTemperature || config.topics?.setCoolingThresholdTemperature) {
    characteristic_CoolingThresholdTemperature(thing, service);
  }
  if (config.topics?.getHeatingThresholdTemperature || config.topics?.setHeatingThresholdTemperature) {
    characteristic_HeatingThresholdTemperature(thing, service);
  }
  if (config.topics?.getTemperatureDisplayUnits || config.topics?.setTemperatureDisplayUnits) {
    characteristic_TemperatureDisplayUnits(thing, service);
  }
  if (config.topics?.getRotationSpeed || config.topics?.setRotationSpeed) {
    characteristic_RotationSpeed(thing, service);
  }
  if (config.topics?.getStatusFault) {
    characteristic_StatusFault(thing, service);
  }
  return { service };
});

// dehumidifier (upstream index.js:3054-3067) - note upstream builds a
// HumidifierDehumidifier service for this type
registerServiceType('dehumidifier', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.HumidifierDehumidifier(config.name, config.subtype);
  characteristic_Active(thing, service);
  characteristic_CurrentRelativeHumidity(thing, service);
  characteristic_CurrentHumidifierDehumidifierState(thing, service);
  characteristic_TargetHumidifierDehumidifierState(thing, service);

  if (config.topics?.setRelativeHumidityDehumidifierThreshold) {
    characteristic_RelativeHumidityDehumidifierThreshold(thing, service);
  }

  if (config.topics?.getWaterLevel) {
    characteristic_WaterLevel(thing, service);
  }
  return { service };
});
