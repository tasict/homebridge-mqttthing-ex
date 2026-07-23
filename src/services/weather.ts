// weatherStation accessory type.
// Ported from upstream index.js dispatch branch (2952-3024).
import type { Service } from 'homebridge';

import { WEATHER_SERVICE_UUID } from '../hap/eve.js';
import {
  floatCharacteristic,
  integerCharacteristic,
  stringCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import { registerServiceType } from './registry.js';
import {
  addSensorOptionalCharacteristics,
  characteristic_AirPressure,
  characteristic_CurrentAmbientLightLevel,
  characteristic_CurrentRelativeHumidity,
  characteristic_CurrentTemperature,
  historyNotYetAvailable,
} from './shared.js';

// Characteristic.WeatherCondition (Eve-only) (upstream index.js:1714)
function characteristic_WeatherCondition(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.Condition); // to avoid warnings
  stringCharacteristic(thing, service, 'weatherCondition', thing.eve.Characteristics.Condition, undefined, config.topics?.getWeatherCondition, '-');
}

// Characteristic.Rain1h (Eve-only) (upstream index.js:1720)
function characteristic_Rain1h(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.Rain1h); // to avoid warnings
  integerCharacteristic(thing, service, 'rain1h', thing.eve.Characteristics.Rain1h, undefined, config.topics?.getRain1h);
}

// Characteristic.Rain24h (Eve-only) (upstream index.js:1726)
function characteristic_Rain24h(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.Rain24h); // to avoid warnings
  integerCharacteristic(thing, service, 'rain24h', thing.eve.Characteristics.Rain24h, undefined, config.topics?.getRain24h);
}

// Characteristic.UVIndex (Eve-only) (upstream index.js:1732)
function characteristic_UVIndex(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.UvIndex); // to avoid warnings
  integerCharacteristic(thing, service, 'uvIndex', thing.eve.Characteristics.UvIndex, undefined, config.topics?.getUVIndex);
}

// Characteristic.Visibility (Eve-only) (upstream index.js:1738)
function characteristic_Visibility(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.Visibility); // to avoid warnings
  integerCharacteristic(thing, service, 'visibility', thing.eve.Characteristics.Visibility, undefined, config.topics?.getVisibility);
}

// Characteristic.WindDirection (Eve-only) (upstream index.js:1744)
function characteristic_WindDirection(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.WindDirection); // to avoid warnings
  stringCharacteristic(thing, service, 'windDirection', thing.eve.Characteristics.WindDirection, undefined, config.topics?.getWindDirection, '-');
}

// Characteristic.WindSpeed (Eve-only) (upstream index.js:1750)
function characteristic_WindSpeed(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.WindSpeed); // to avoid warnings
  floatCharacteristic(thing, service, 'windSpeed', thing.eve.Characteristics.WindSpeed, undefined, config.topics?.getWindSpeed, 0);
}

// Characteristic.maxWind (Eve-only) (upstream index.js:1756)
function characteristic_MaximumWindSpeed(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.MaximumWindSpeed); // to avoid warnings
  floatCharacteristic(thing, service, 'maxWind', thing.eve.Characteristics.MaximumWindSpeed, undefined, config.topics?.getmaxWind, 0);
}

// Characteristic.Dewpoint (Eve-only) (upstream index.js:1762)
function characteristic_DewPoint(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.DewPoint); // to avoid warnings
  floatCharacteristic(thing, service, 'DewPoint', thing.eve.Characteristics.DewPoint, undefined, config.topics?.getDewPoint, 0);
}

// weatherStation (upstream index.js:2952-3024)
registerServiceType('weatherStation', (thing) => {
  const { config, hap } = thing;
  const name = config.name;
  const subtype = config.subtype;
  const svcNames = (config.serviceNames || {}) as Record<string, string | undefined>; // custom names for multi-service accessories

  const service = new hap.Service.TemperatureSensor(svcNames.temperature || name + ' Temperature', subtype);
  characteristic_CurrentTemperature(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  const services = [service];
  if (config.topics?.getCurrentRelativeHumidity) {
    const humSvc = new hap.Service.HumiditySensor(svcNames.humidity || name + ' Humidity', subtype);
    characteristic_CurrentRelativeHumidity(thing, humSvc);
    addSensorOptionalCharacteristics(thing, humSvc);
    services.push(humSvc);
  }
  if (config.topics?.getAirPressure) {
    const presSvc = new thing.eve.Services.AirPressureSensor(svcNames.airPressure || name + ' AirPressure', subtype);
    characteristic_AirPressure(thing, presSvc);
    addSensorOptionalCharacteristics(thing, presSvc);
    services.push(presSvc);
  }
  if (config.topics?.getCurrentAmbientLightLevel) {
    const lightSvc = new hap.Service.LightSensor(svcNames.ambientLightLevel || name + ' Light Level', subtype);
    characteristic_CurrentAmbientLightLevel(thing, lightSvc);
    addSensorOptionalCharacteristics(thing, lightSvc);
    services.push(lightSvc);
  }
  // custom service UUID for optional Eve characteristics
  const weatherSvc = new hap.Service(svcNames.weather || name + ' Weather', WEATHER_SERVICE_UUID);
  let addWeatherSvc = false;
  if (config.topics?.getWeatherCondition) {
    characteristic_WeatherCondition(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getRain1h) {
    characteristic_Rain1h(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getRain24h) {
    characteristic_Rain24h(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getUVIndex) {
    characteristic_UVIndex(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getVisibility) {
    characteristic_Visibility(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getWindDirection) {
    characteristic_WindDirection(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getWindSpeed) {
    characteristic_WindSpeed(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getmaxWind) {
    characteristic_MaximumWindSpeed(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (config.topics?.getDewPoint) {
    characteristic_DewPoint(thing, weatherSvc);
    addWeatherSvc = true;
  }
  if (addWeatherSvc) {
    services.push(weatherSvc);
  }
  // TODO(M5): history - upstream index.js:3017-3024 ('weather' history service)
  historyNotYetAvailable(thing);
  return { service, services };
});
