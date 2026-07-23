// Basic accessory types: switch, outlet, simple sensors, battery.
// Ported from upstream index.js dispatch branches (2859-2951, 3509-3511).
import {
  history_AirPressure,
  history_CurrentRelativeHumidity,
  history_CurrentTemperature,
  history_MotionDetected,
  history_On,
  history_PowerConsumption,
  makeHistoryService,
} from '../features/history.js';
import { registerServiceType } from './registry.js';
import {
  addSensorOptionalCharacteristics,
  addBatteryCharacteristics,
  characteristic_CurrentAmbientLightLevel,
  characteristic_CurrentConsumption,
  characteristic_CurrentRelativeHumidity,
  characteristic_CurrentTemperature,
  characteristic_AirPressure,
  characteristic_ElectricCurrent,
  characteristic_MotionDetected,
  characteristic_OccupancyDetected,
  characteristic_On,
  characteristic_OutletInUse,
  characteristic_TotalConsumption,
  characteristic_Voltage,
} from './shared.js';

registerServiceType('switch', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Switch(config.name, config.subtype);
  characteristic_On(thing, service);
  const services = [service];
  // 'switch' history (upstream index.js:2863-2869)
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'switch');
    if (historySvc) {
      history_On(thing, historySvc, service);
      // return history service too
      services.push(historySvc);
    }
  }
  return { service, services };
});

registerServiceType('outlet', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Outlet(config.name, config.subtype);
  characteristic_On(thing, service);
  if (config.topics?.getInUse) {
    characteristic_OutletInUse(thing, service);
  }
  if (config.topics?.getWatts) {
    characteristic_CurrentConsumption(thing, service);
  }
  if (config.topics?.getVolts) {
    characteristic_Voltage(thing, service);
  }
  if (config.topics?.getAmperes) {
    characteristic_ElectricCurrent(thing, service);
  }
  if (config.topics?.getTotalConsumption) {
    characteristic_TotalConsumption(thing, service);
  }
  const services = [service];
  // 'energy' history (upstream index.js:2889-2895)
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'energy');
    if (historySvc) {
      history_PowerConsumption(thing, historySvc, service);
      // return history service too
      services.push(historySvc);
    }
  }
  return { service, services };
});

registerServiceType('motionSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.MotionSensor(config.name, config.subtype);
  characteristic_MotionDetected(thing, service);
  const services = [service];
  // 'motion' history (upstream index.js:2900-2906)
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'motion', true);
    if (historySvc) {
      history_MotionDetected(thing, historySvc, service);
      // return history service too
      services.push(historySvc);
    }
  }
  addSensorOptionalCharacteristics(thing, service);
  return { service, services };
});

registerServiceType('occupancySensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.OccupancySensor(config.name, config.subtype);
  characteristic_OccupancyDetected(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  return { service };
});

registerServiceType('lightSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.LightSensor(config.name, config.subtype);
  characteristic_CurrentAmbientLightLevel(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  return { service };
});

registerServiceType('temperatureSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.TemperatureSensor(config.name, config.subtype);
  characteristic_CurrentTemperature(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  // 'weather' history (upstream index.js:2921-2927)
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'weather');
    if (historySvc) {
      history_CurrentTemperature(thing, historySvc);
      // return history service too
      services.push(historySvc);
    }
  }
  return { service, services };
});

registerServiceType('humiditySensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.HumiditySensor(config.name, config.subtype);
  characteristic_CurrentRelativeHumidity(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  // 'weather' history (upstream index.js:2933-2939)
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'weather');
    if (historySvc) {
      history_CurrentRelativeHumidity(thing, historySvc);
      // return history service too
      services.push(historySvc);
    }
  }
  return { service, services };
});

registerServiceType('airPressureSensor', (thing) => {
  const { config } = thing;
  const service = new thing.eve.Services.AirPressureSensor(config.name, config.subtype);
  characteristic_AirPressure(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  // 'weather' history (upstream index.js:2945-2951)
  if (config.history) {
    const historySvc = makeHistoryService(thing, 'weather');
    if (historySvc) {
      history_AirPressure(thing, historySvc);
      // return history service too
      services.push(historySvc);
    }
  }
  return { service, services };
});

registerServiceType('battery', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Battery(config.name);
  addBatteryCharacteristics(thing, service);
  return { service };
});
