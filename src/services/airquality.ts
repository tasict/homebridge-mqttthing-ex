// Air quality accessory types: airQualitySensor, carbonDioxideSensor,
// carbonMonoxideSensor.
// Ported from upstream index.js dispatch branches (3223-3282, 3283-3292, 3293-3302).
import type { Service } from 'homebridge';

import {
  history_AirQualityPPM,
  history_CurrentRelativeHumidity,
  history_CurrentTemperature,
  history_VOCDensity,
  makeHistoryService,
} from '../features/history.js';
import {
  floatCharacteristic,
  multiCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import { characteristic_TemperatureDisplayUnits } from './controls.js';
import { registerServiceType } from './registry.js';
import {
  addSensorOptionalCharacteristics,
  characteristic_CurrentRelativeHumidity,
  characteristic_CurrentTemperature,
} from './shared.js';

// Characteristic.AirQuality (upstream index.js:2132)
function characteristic_AirQuality(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.airQualityValues as unknown[] | undefined;
  if (!values) {
    values = ['UNKNOWN', 'EXCELLENT', 'GOOD', 'FAIR', 'INFERIOR', 'POOR'];
  }
  multiCharacteristic(
    thing,
    service,
    'airQuality',
    hap.Characteristic.AirQuality,
    undefined,
    config.topics?.getAirQuality,
    values,
    hap.Characteristic.AirQuality.UNKNOWN,
  );
}

// Characteristic.PM10Density (upstream index.js:2141)
function characteristic_PM10Density(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  // upstream quirk: passes Characteristic.PM10Density.UNKNOWN (an undefined
  // static) as the initial value, which floatCharacteristic defaults to 0
  floatCharacteristic(
    thing,
    service,
    'pm10density',
    hap.Characteristic.PM10Density,
    undefined,
    config.topics?.getPM10Density,
    (hap.Characteristic.PM10Density as unknown as { UNKNOWN?: number }).UNKNOWN,
  );
}

// Characteristic.PM2_5Density (upstream index.js:2146)
function characteristic_PM2_5Density(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  // upstream quirk: passes Characteristic.PM2_5Density.UNKNOWN (an undefined
  // static) as the initial value, which floatCharacteristic defaults to 0
  floatCharacteristic(
    thing,
    service,
    'pm2_5density',
    hap.Characteristic.PM2_5Density,
    undefined,
    config.topics?.getPM2_5Density,
    (hap.Characteristic.PM2_5Density as unknown as { UNKNOWN?: number }).UNKNOWN,
  );
}

// Characteristic.OzoneDensity (upstream index.js:2151)
function characteristic_OzoneDensity(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'ozoneDensity', hap.Characteristic.OzoneDensity, undefined, config.topics?.getOzoneDensity);
}

// Characteristic.NitrogenDioxideDensity (upstream index.js:2156)
function characteristic_NitrogenDioxideDensity(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'nitrogenDioxideDensity', hap.Characteristic.NitrogenDioxideDensity, undefined, config.topics?.getNitrogenDioxideDensity);
}

// Characteristic.SulphurDioxideDensity (upstream index.js:2161)
function characteristic_SulphurDioxideDensity(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'sulphurDioxideDensity', hap.Characteristic.SulphurDioxideDensity, undefined, config.topics?.getSulphurDioxideDensity);
}

// Characteristic.VOCDensity (upstream index.js:2166)
function characteristic_VOCDensity(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'VOCDensity', hap.Characteristic.VOCDensity, undefined, config.topics?.getVOCDensity);
}

// Characteristic.CarbonMonoxideLevel (upstream index.js:2171)
function characteristic_CarbonMonoxideLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'carbonMonoxideLevel', hap.Characteristic.CarbonMonoxideLevel, undefined, config.topics?.getCarbonMonoxideLevel);
}

// Characteristic.CarbonMonoxideDetected (upstream index.js:2175)
function characteristic_CarbonMonoxideDetected(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.carbonMonoxideDetectedValues as unknown[] | undefined;
  if (!values) {
    values = ['NORMAL', 'ABNORMAL'];
  }
  multiCharacteristic(
    thing,
    service,
    'carbonMonoxideDetected',
    hap.Characteristic.CarbonMonoxideDetected,
    undefined,
    config.topics?.getCarbonMonoxideDetected,
    values,
    hap.Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
  );
}

// upstream quirk (index.js:3297-3302): the carbonMonoxideSensor dispatch reads
// lower-case topic keys (getcarbonMonoxideLevel/getcarbonMonoxidePeakLevel)
// and calls characteristic_carbonMonoxideLevel/..._carbonMonoxidePeakLevel,
// which upstream never defines (ReferenceError when configured). The
// lower-case topic keys are kept verbatim for config compatibility; the
// helpers are defined here (modelled on the CamelCase versions) so the
// characteristics actually work.
function characteristic_carbonMonoxideLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'carbonMonoxideLevel', hap.Characteristic.CarbonMonoxideLevel, undefined, config.topics?.getcarbonMonoxideLevel);
}

function characteristic_carbonMonoxidePeakLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'carbonMonoxidePeakLevel', hap.Characteristic.CarbonMonoxidePeakLevel, undefined, config.topics?.getcarbonMonoxidePeakLevel, 0);
}

// Eve.Characteristics.AirParticulateDensity (upstream index.js:2189)
function characteristic_AirQualityPPM(thing: ThingContext, service: Service): void {
  const { config } = thing;
  service.addOptionalCharacteristic(thing.eve.Characteristics.AirParticulateDensity); // to avoid warnings
  floatCharacteristic(thing, service, 'airQualityPPM', thing.eve.Characteristics.AirParticulateDensity, undefined, config.topics?.getAirQualityPPM);
}

// Characteristic.CarbonDioxideDetected (upstream index.js:2233)
function characteristic_CarbonDioxideDetected(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  let values = config.carbonDioxideDetectedValues as unknown[] | undefined;
  if (!values) {
    values = ['NORMAL', 'ABNORMAL'];
  }
  multiCharacteristic(
    thing,
    service,
    'carbonDioxideDetected',
    hap.Characteristic.CarbonDioxideDetected,
    undefined,
    config.topics?.getCarbonDioxideDetected,
    values,
    hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL,
  );
}

// Characteristic.CarbonDioxideLevel (upstream index.js:2242)
function characteristic_CarbonDioxideLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'carbonDioxideLevel', hap.Characteristic.CarbonDioxideLevel, undefined, config.topics?.getCarbonDioxideLevel, 0);
}

// Characteristic.CarbonDioxidePeakLevel (upstream index.js:2247)
function characteristic_CarbonDioxidePeakLevel(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  floatCharacteristic(thing, service, 'carbonDioxidePeakLevel', hap.Characteristic.CarbonDioxidePeakLevel, undefined, config.topics?.getCarbonDioxidePeakLevel, 0);
}

// airQualitySensor (upstream index.js:3223-3282)
registerServiceType('airQualitySensor', (thing) => {
  const { config, hap } = thing;
  const name = config.name;
  const subtype = config.subtype;
  const svcNames = (config.serviceNames || {}) as Record<string, string | undefined>;
  const service = new hap.Service.AirQualitySensor(svcNames.airQuality || name, subtype);
  characteristic_AirQuality(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  if (config.topics?.getCarbonDioxideLevel) {
    characteristic_CarbonDioxideLevel(thing, service);
  }
  if (config.topics?.getPM10Density) {
    characteristic_PM10Density(thing, service);
  }
  if (config.topics?.getPM2_5Density) {
    characteristic_PM2_5Density(thing, service);
  }
  if (config.topics?.getOzoneDensity) {
    characteristic_OzoneDensity(thing, service);
  }
  if (config.topics?.getNitrogenDioxideDensity) {
    characteristic_NitrogenDioxideDensity(thing, service);
  }
  if (config.topics?.getSulphurDioxideDensity) {
    characteristic_SulphurDioxideDensity(thing, service);
  }
  if (config.topics?.getVOCDensity) {
    characteristic_VOCDensity(thing, service);
  }
  if (config.topics?.getCarbonMonoxideLevel) {
    characteristic_CarbonMonoxideLevel(thing, service);
  }
  const services = [service];
  if (config.topics?.getCurrentTemperature) {
    const tempSvc = new hap.Service.TemperatureSensor(svcNames.temperature || name + '-Temperature', subtype);
    characteristic_CurrentTemperature(thing, tempSvc);
    characteristic_TemperatureDisplayUnits(thing, tempSvc);
    addSensorOptionalCharacteristics(thing, tempSvc);
    services.push(tempSvc);
  }
  if (config.topics?.getCurrentRelativeHumidity) {
    const humSvc = new hap.Service.HumiditySensor(svcNames.humidity || name + '-Humidity', subtype);
    characteristic_CurrentRelativeHumidity(thing, humSvc);
    addSensorOptionalCharacteristics(thing, humSvc);
    services.push(humSvc);
  }
  if (config.history && config.room2) {
    // 'room2' history (upstream index.js:3265-3271)
    const historySvc = makeHistoryService(thing, 'room2');
    if (historySvc) {
      history_VOCDensity(thing, historySvc);
      history_CurrentTemperature(thing, historySvc);
      history_CurrentRelativeHumidity(thing, historySvc);
      services.push(historySvc);
    }
  } else if (config.history) {
    // 'room' history (upstream index.js:3272-3282); upstream adds the Eve air
    // quality PPM characteristic to the main service inside this branch
    if (config.topics?.getAirQualityPPM) {
      characteristic_AirQualityPPM(thing, service);
    }
    const historySvc = makeHistoryService(thing, 'room');
    if (historySvc) {
      history_AirQualityPPM(thing, historySvc);
      history_CurrentTemperature(thing, historySvc);
      history_CurrentRelativeHumidity(thing, historySvc);
      services.push(historySvc);
    }
  }
  return { service, services };
});

// carbonDioxideSensor (upstream index.js:3283-3292)
registerServiceType('carbonDioxideSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.CarbonDioxideSensor(config.name, config.subtype);
  characteristic_CarbonDioxideDetected(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  if (config.topics?.getCarbonDioxideLevel) {
    characteristic_CarbonDioxideLevel(thing, service);
  }
  if (config.topics?.getCarbonDioxidePeakLevel) {
    characteristic_CarbonDioxidePeakLevel(thing, service);
  }
  return { service };
});

// carbonMonoxideSensor (upstream index.js:3293-3302)
registerServiceType('carbonMonoxideSensor', (thing) => {
  const { config, hap } = thing;
  const service = new hap.Service.CarbonMonoxideSensor(config.name, config.subtype);
  characteristic_CarbonMonoxideDetected(thing, service);
  addSensorOptionalCharacteristics(thing, service);
  if (config.topics?.getcarbonMonoxideLevel) {
    characteristic_carbonMonoxideLevel(thing, service);
  }
  if (config.topics?.getcarbonMonoxidePeakLevel) {
    characteristic_carbonMonoxidePeakLevel(thing, service);
  }
  return { service };
});
