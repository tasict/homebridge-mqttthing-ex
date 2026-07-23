// Basic accessory types: switch, outlet, simple sensors, battery.
// Ported from upstream index.js dispatch branches (2859-2951, 3509-3511).
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
  historyNotYetAvailable,
} from './shared.js';

registerServiceType('switch', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Switch(config.name, config.subtype);
  characteristic_On(thing, service);
  const services = [service];
  historyNotYetAvailable(thing);
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
  historyNotYetAvailable(thing);
  return { service, services };
});

registerServiceType('motionSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.MotionSensor(config.name, config.subtype);
  characteristic_MotionDetected(thing, service);
  const services = [service];
  historyNotYetAvailable(thing);
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
  historyNotYetAvailable(thing);
  return { service, services };
});

registerServiceType('humiditySensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.HumiditySensor(config.name, config.subtype);
  characteristic_CurrentRelativeHumidity(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  historyNotYetAvailable(thing);
  return { service, services };
});

registerServiceType('airPressureSensor', (thing) => {
  const { config } = thing;
  const service = new thing.eve.Services.AirPressureSensor(config.name, config.subtype);
  characteristic_AirPressure(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  historyNotYetAvailable(thing);
  return { service, services };
});

registerServiceType('battery', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.Battery(config.name);
  addBatteryCharacteristics(thing, service);
  return { service };
});
