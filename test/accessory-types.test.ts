// Tests for the accessory types ported from upstream index.js:
// thermostat, heaterCooler, dehumidifier, fan, fanv2, airPurifier,
// airQualitySensor, carbonDioxideSensor, carbonMonoxideSensor,
// weatherStation, television, irrigationSystem.
import { Buffer } from 'node:buffer';
import net from 'node:net';
import os from 'node:os';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// importing these modules registers the ported accessory types
import '../src/services/climate.js';
import '../src/services/fans.js';
import '../src/services/airquality.js';
import '../src/services/weather.js';
import '../src/services/media.js';
import '../src/services/irrigation.js';

import { makeEve, WEATHER_SERVICE_UUID } from '../src/hap/eve.js';
import { closeAccessories, makeAccessory, makeMockApi } from './hap-helpers.js';

const { Service, Characteristic } = hapNodeJs;
const eve = makeEve(hapNodeJs as never);

let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let port: number;
let url: string;
const api = makeMockApi(os.tmpdir());

const seen: Array<{ topic: string; payload: string }> = [];

beforeAll(async () => {
  broker = new Aedes();
  broker.on('publish', (packet) => {
    if (!packet.topic.startsWith('$SYS')) {
      seen.push({ topic: packet.topic, payload: String(packet.payload) });
    }
  });
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as net.AddressInfo).port;
  url = 'mqtt://localhost:' + port;
});

afterAll(async () => {
  closeAccessories();
  await new Promise<void>((resolve) => broker.close(resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function waitForSubscription(topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timeout for ' + topic)), 5000);
    const listener = (subscriptions: Array<{ topic: string }>) => {
      if (subscriptions.some((s) => s.topic === topic)) {
        clearTimeout(timer);
        broker.removeListener('subscribe', listener as never);
        resolve();
      }
    };
    broker.on('subscribe', listener as never);
  });
}

function brokerPublish(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) =>
    broker.publish(
      { cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}

function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (cond()) {
        return resolve();
      }
      if (Date.now() - start > ms) {
        return reject(new Error('waitFor timeout'));
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

describe('thermostat', () => {
  it('builds the thermostat service with configured temperature range', () => {
    const { accessory } = makeAccessory(
      {
        type: 'thermostat',
        name: 'Th1',
        url,
        minTemperature: 5,
        maxTemperature: 30,
        topics: {
          setTargetHeatingCoolingState: 't/th1/mode/set',
          getTargetHeatingCoolingState: 't/th1/mode/get',
          getCurrentHeatingCoolingState: 't/th1/state/get',
          getCurrentTemperature: 't/th1/current',
          setTargetTemperature: 't/th1/target/set',
          getTargetTemperature: 't/th1/target/get',
          getCurrentRelativeHumidity: 't/th1/humidity',
          setCoolingThresholdTemperature: 't/th1/cool/set',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Thermostat)!;
    expect(svc).toBeDefined();
    for (const c of [
      Characteristic.Active, // added by upstream's thermostat branch
      Characteristic.CurrentHeatingCoolingState,
      Characteristic.TargetHeatingCoolingState,
      Characteristic.CurrentTemperature,
      Characteristic.TargetTemperature,
      Characteristic.TemperatureDisplayUnits,
      Characteristic.CurrentRelativeHumidity,
      Characteristic.CoolingThresholdTemperature,
    ]) {
      expect(svc.testCharacteristic(c)).toBe(true);
    }
    // target temperature default 10, custom range via tempRange
    expect(svc.getCharacteristic(Characteristic.TargetTemperature).value).toBe(10);
    expect(svc.getCharacteristic(Characteristic.TargetTemperature).props.minValue).toBe(5);
    expect(svc.getCharacteristic(Characteristic.TargetTemperature).props.maxValue).toBe(30);
    // F3: the configured range must NOT clamp CurrentTemperature (upstream
    // #587/#592) - it keeps the wide default so real readings stay valid
    expect(svc.getCharacteristic(Characteristic.CurrentTemperature).props.minValue).toBe(-100);
    expect(svc.getCharacteristic(Characteristic.CurrentTemperature).props.maxValue).toBe(100);
  });

  it('maps heatingCoolingStateValues strings from MQTT and publishes them on set', async () => {
    const sub = waitForSubscription('t/th2/mode/get');
    const { accessory } = makeAccessory(
      {
        type: 'thermostat',
        name: 'Th2',
        url,
        topics: {
          setTargetHeatingCoolingState: 't/th2/mode/set',
          getTargetHeatingCoolingState: 't/th2/mode/get',
          getCurrentTemperature: 't/th2/current',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Thermostat)!;
    const target = svc.getCharacteristic(Characteristic.TargetHeatingCoolingState);
    await sub;
    await brokerPublish('t/th2/mode/get', 'HEAT');
    await waitFor(() => target.value === Characteristic.TargetHeatingCoolingState.HEAT);
    await target.setValue(Characteristic.TargetHeatingCoolingState.COOL);
    await waitFor(() => seen.some((p) => p.topic === 't/th2/mode/set' && p.payload === 'COOL'));
  });
});

describe('heaterCooler', () => {
  it('builds the heater cooler service with optional characteristics and restrictHeaterCoolerState', () => {
    const { accessory } = makeAccessory(
      {
        type: 'heaterCooler',
        name: 'Hc1',
        url,
        restrictHeaterCoolerState: [1, 2],
        topics: {
          setActive: 't/hc1/active/set',
          getCurrentHeaterCoolerState: 't/hc1/state',
          setTargetHeaterCoolerState: 't/hc1/mode/set',
          getTargetHeaterCoolerState: 't/hc1/mode/get',
          getCurrentTemperature: 't/hc1/current',
          setRotationSpeed: 't/hc1/speed/set',
          setSwingMode: 't/hc1/swing/set',
          setLockPhysicalControls: 't/hc1/lock/set',
          setCoolingThresholdTemperature: 't/hc1/cool/set',
          setHeatingThresholdTemperature: 't/hc1/heat/set',
          setTemperatureDisplayUnits: 't/hc1/units/set',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.HeaterCooler)!;
    expect(svc).toBeDefined();
    for (const c of [
      Characteristic.Active,
      Characteristic.CurrentHeaterCoolerState,
      Characteristic.TargetHeaterCoolerState,
      Characteristic.CurrentTemperature,
      Characteristic.RotationSpeed,
      Characteristic.SwingMode,
      Characteristic.LockPhysicalControls,
      Characteristic.CoolingThresholdTemperature,
      Characteristic.HeatingThresholdTemperature,
      Characteristic.TemperatureDisplayUnits,
    ]) {
      expect(svc.testCharacteristic(c)).toBe(true);
    }
    expect(svc.getCharacteristic(Characteristic.TargetHeaterCoolerState).props.validValues).toEqual([1, 2]);
    // threshold defaults
    expect(svc.getCharacteristic(Characteristic.CoolingThresholdTemperature).value).toBe(25);
    expect(svc.getCharacteristic(Characteristic.HeatingThresholdTemperature).value).toBe(20);
  });

  it('updates the current state from MQTT and publishes the target state', async () => {
    const sub = waitForSubscription('t/hc2/state');
    const { accessory } = makeAccessory(
      {
        type: 'heaterCooler',
        name: 'Hc2',
        url,
        topics: {
          getCurrentHeaterCoolerState: 't/hc2/state',
          setTargetHeaterCoolerState: 't/hc2/mode/set',
          getCurrentTemperature: 't/hc2/current',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.HeaterCooler)!;
    const current = svc.getCharacteristic(Characteristic.CurrentHeaterCoolerState);
    await sub;
    await brokerPublish('t/hc2/state', 'HEATING');
    await waitFor(() => current.value === Characteristic.CurrentHeaterCoolerState.HEATING);
    await svc.getCharacteristic(Characteristic.TargetHeaterCoolerState).setValue(Characteristic.TargetHeaterCoolerState.HEAT);
    await waitFor(() => seen.some((p) => p.topic === 't/hc2/mode/set' && p.payload === 'HEAT'));
  });
});

describe('dehumidifier', () => {
  it('builds a HumidifierDehumidifier service and round-trips MQTT', async () => {
    const sub = waitForSubscription('t/dh1/humidity');
    const { accessory } = makeAccessory(
      {
        type: 'dehumidifier',
        name: 'Dh1',
        url,
        topics: {
          setActive: 't/dh1/active/set',
          getCurrentRelativeHumidity: 't/dh1/humidity',
          getCurrentHumidifierDehumidifierState: 't/dh1/state',
          setTargetHumidifierDehumidifierState: 't/dh1/mode/set',
          setRelativeHumidityDehumidifierThreshold: 't/dh1/threshold/set',
          getWaterLevel: 't/dh1/water',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.HumidifierDehumidifier)!;
    expect(svc).toBeDefined();
    for (const c of [
      Characteristic.Active,
      Characteristic.CurrentRelativeHumidity,
      Characteristic.CurrentHumidifierDehumidifierState,
      Characteristic.TargetHumidifierDehumidifierState,
      Characteristic.RelativeHumidityDehumidifierThreshold,
      Characteristic.WaterLevel,
    ]) {
      expect(svc.testCharacteristic(c)).toBe(true);
    }
    const humidity = svc.getCharacteristic(Characteristic.CurrentRelativeHumidity);
    await sub;
    await brokerPublish('t/dh1/humidity', '55');
    await waitFor(() => humidity.value === 55);
    await svc
      .getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
      .setValue(Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER);
    await waitFor(() => seen.some((p) => p.topic === 't/dh1/mode/set' && p.payload === 'DEHUMIDIFIER'));
  });
});

describe('fan', () => {
  it('builds a fan with On and RotationSpeed and round-trips MQTT', async () => {
    const sub = waitForSubscription('t/fan1/speed/get');
    const { accessory } = makeAccessory(
      {
        type: 'fan',
        name: 'Fan1',
        url,
        topics: {
          setOn: 't/fan1/on/set',
          getOn: 't/fan1/on/get',
          setRotationSpeed: 't/fan1/speed/set',
          getRotationSpeed: 't/fan1/speed/get',
          setRotationDirection: 't/fan1/dir/set',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Fan)!;
    expect(svc.testCharacteristic(Characteristic.On)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.RotationSpeed)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.RotationDirection)).toBe(true);
    const speed = svc.getCharacteristic(Characteristic.RotationSpeed);
    await sub;
    await brokerPublish('t/fan1/speed/get', '42');
    await waitFor(() => speed.value === 42);
    await svc.getCharacteristic(Characteristic.On).setValue(true);
    await waitFor(() => seen.some((p) => p.topic === 't/fan1/on/set' && p.payload === 'true'));
  });

  it('handles On through RotationSpeed when no setOn topic is configured', async () => {
    const sub = waitForSubscription('t/fan2/speed/get');
    const { accessory } = makeAccessory(
      {
        type: 'fan',
        name: 'Fan2',
        url,
        topics: {
          setRotationSpeed: 't/fan2/speed/set',
          getRotationSpeed: 't/fan2/speed/get',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Fan)!;
    // On characteristic is provided by the RotationSpeed handler
    expect(svc.testCharacteristic(Characteristic.On)).toBe(true);
    const on = svc.getCharacteristic(Characteristic.On);
    await sub;
    // turning on with speed 0 publishes rotation speed 100
    await on.setValue(true);
    await waitFor(() => seen.some((p) => p.topic === 't/fan2/speed/set' && p.payload === '100'));
    // rotation speed 0 from MQTT turns the fan off
    await brokerPublish('t/fan2/speed/get', '0');
    await waitFor(() => on.value === false);
  });
});

describe('fanv2', () => {
  it('preserves the upstream quirk of reading config.getCurrentFanState (not topics)', async () => {
    const sub = waitForSubscription('t/fv2a/fanstate');
    const { accessory } = makeAccessory(
      {
        type: 'fanv2',
        name: 'Fv2a',
        url,
        getCurrentFanState: true, // upstream reads this config property, not topics
        topics: {
          setActive: 't/fv2a/active/set',
          getCurrentFanState: 't/fv2a/fanstate',
          setTargetFanState: 't/fv2a/target/set',
          setRotationSpeed: 't/fv2a/speed/set',
          setSwingMode: 't/fv2a/swing/set',
          setLockPhysicalControls: 't/fv2a/lock/set',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Fanv2)!;
    expect(svc).toBeDefined();
    for (const c of [
      Characteristic.Active,
      Characteristic.CurrentFanState,
      Characteristic.TargetFanState,
      Characteristic.RotationSpeed,
      Characteristic.SwingMode,
      Characteristic.LockPhysicalControls,
    ]) {
      expect(svc.testCharacteristic(c)).toBe(true);
    }
    const current = svc.getCharacteristic(Characteristic.CurrentFanState);
    await sub;
    await brokerPublish('t/fv2a/fanstate', 'BLOWING_AIR');
    await waitFor(() => current.value === Characteristic.CurrentFanState.BLOWING_AIR);
    await svc.getCharacteristic(Characteristic.Active).setValue(Characteristic.Active.ACTIVE);
    await waitFor(() => seen.some((p) => p.topic === 't/fv2a/active/set' && p.payload === 'true'));
  });

  it('adds CurrentFanState from topics.getCurrentFanState (F15)', () => {
    // upstream only honored a top-level config.getCurrentFanState key; the
    // correct topics key now works too (see docs/UpstreamIssues.md F15)
    const { accessory } = makeAccessory(
      {
        type: 'fanv2',
        name: 'Fv2b',
        url,
        topics: {
          setActive: 't/fv2b/active/set',
          getCurrentFanState: 't/fv2b/fanstate',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Fanv2)!;
    expect(svc.testCharacteristic(Characteristic.CurrentFanState)).toBe(true);
  });
});

describe('airPurifier', () => {
  it('builds an air purifier with a linked filter maintenance service', async () => {
    const sub = waitForSubscription('t/ap1/state');
    const { accessory } = makeAccessory(
      {
        type: 'airPurifier',
        name: 'Ap1',
        url,
        topics: {
          setActive: 't/ap1/active/set',
          getCurrentAirPurifierState: 't/ap1/state',
          setTargetAirPurifierState: 't/ap1/target/set',
          getTargetAirPurifierState: 't/ap1/target/get',
          setRotationSpeed: 't/ap1/speed/set',
          getFilterChangeIndication: 't/ap1/filter/change',
          getFilterLifeLevel: 't/ap1/filter/life',
          setResetFilterIndication: 't/ap1/filter/reset',
        },
      },
      api,
    );
    const services = accessory.getServices();
    const svc = services.find((s) => s instanceof Service.AirPurifier)!;
    expect(svc).toBeDefined();
    for (const c of [
      Characteristic.Active,
      Characteristic.CurrentAirPurifierState,
      Characteristic.TargetAirPurifierState,
      Characteristic.RotationSpeed,
    ]) {
      expect(svc.testCharacteristic(c)).toBe(true);
    }
    const filterSvc = services.find((s) => s instanceof Service.FilterMaintenance)!;
    expect(filterSvc).toBeDefined();
    expect(filterSvc.displayName).toBe('Ap1-Filter');
    expect(svc.linkedServices).toContain(filterSvc);
    expect(filterSvc.testCharacteristic(Characteristic.FilterChangeIndication)).toBe(true);
    expect(filterSvc.testCharacteristic(Characteristic.FilterLifeLevel)).toBe(true);
    expect(filterSvc.testCharacteristic(Characteristic.ResetFilterIndication)).toBe(true);
    const current = svc.getCharacteristic(Characteristic.CurrentAirPurifierState);
    await sub;
    await brokerPublish('t/ap1/state', 'PURIFYING');
    await waitFor(() => current.value === Characteristic.CurrentAirPurifierState.PURIFYING_AIR);
    await svc.getCharacteristic(Characteristic.TargetAirPurifierState).setValue(Characteristic.TargetAirPurifierState.MANUAL);
    await waitFor(() => seen.some((p) => p.topic === 't/ap1/target/set' && p.payload === 'MANUAL'));
  });
});

describe('airQualitySensor', () => {
  it('builds air quality plus linked temperature/humidity services', async () => {
    const sub = waitForSubscription('t/aq1/quality');
    const { accessory } = makeAccessory(
      {
        type: 'airQualitySensor',
        name: 'Aq1',
        url,
        topics: {
          getAirQuality: 't/aq1/quality',
          getVOCDensity: 't/aq1/voc',
          getPM10Density: 't/aq1/pm10',
          getCarbonMonoxideLevel: 't/aq1/co',
          getCurrentTemperature: 't/aq1/temperature',
          getCurrentRelativeHumidity: 't/aq1/humidity',
        },
      },
      api,
    );
    const services = accessory.getServices();
    const svc = services.find((s) => s instanceof Service.AirQualitySensor)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.AirQuality)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.VOCDensity)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.PM10Density)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.CarbonMonoxideLevel)).toBe(true);
    const tempSvc = services.find((s) => s instanceof Service.TemperatureSensor)!;
    expect(tempSvc).toBeDefined();
    expect(tempSvc.displayName).toBe('Aq1-Temperature');
    expect(tempSvc.testCharacteristic(Characteristic.TemperatureDisplayUnits)).toBe(true);
    const humSvc = services.find((s) => s instanceof Service.HumiditySensor)!;
    expect(humSvc).toBeDefined();
    expect(humSvc.displayName).toBe('Aq1-Humidity');
    const quality = svc.getCharacteristic(Characteristic.AirQuality);
    await sub;
    await brokerPublish('t/aq1/quality', 'POOR');
    await waitFor(() => quality.value === Characteristic.AirQuality.POOR);
  });
});

describe('carbonDioxideSensor', () => {
  it('maps detected state and levels from MQTT', async () => {
    const sub = waitForSubscription('t/co2/detected');
    const subLevel = waitForSubscription('t/co2/level');
    const { accessory } = makeAccessory(
      {
        type: 'carbonDioxideSensor',
        name: 'Co2',
        url,
        topics: {
          getCarbonDioxideDetected: 't/co2/detected',
          getCarbonDioxideLevel: 't/co2/level',
          getCarbonDioxidePeakLevel: 't/co2/peak',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.CarbonDioxideSensor)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.CarbonDioxideDetected)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.CarbonDioxideLevel)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.CarbonDioxidePeakLevel)).toBe(true);
    const detected = svc.getCharacteristic(Characteristic.CarbonDioxideDetected);
    const level = svc.getCharacteristic(Characteristic.CarbonDioxideLevel);
    await sub;
    await subLevel;
    await brokerPublish('t/co2/detected', 'ABNORMAL');
    await waitFor(() => detected.value === Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL);
    await brokerPublish('t/co2/level', '812');
    await waitFor(() => level.value === 812);
  });
});

describe('carbonMonoxideSensor', () => {
  it('maps detected state and the lower-case level topics from MQTT', async () => {
    const sub = waitForSubscription('t/co1/detected');
    const subLevel = waitForSubscription('t/co1/level');
    const { accessory } = makeAccessory(
      {
        type: 'carbonMonoxideSensor',
        name: 'Co1',
        url,
        topics: {
          getCarbonMonoxideDetected: 't/co1/detected',
          // upstream reads these lower-case topic names
          getcarbonMonoxideLevel: 't/co1/level',
          getcarbonMonoxidePeakLevel: 't/co1/peak',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.CarbonMonoxideSensor)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.CarbonMonoxideDetected)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.CarbonMonoxideLevel)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.CarbonMonoxidePeakLevel)).toBe(true);
    const detected = svc.getCharacteristic(Characteristic.CarbonMonoxideDetected);
    const level = svc.getCharacteristic(Characteristic.CarbonMonoxideLevel);
    await sub;
    await subLevel;
    await brokerPublish('t/co1/detected', 'ABNORMAL');
    await waitFor(() => detected.value === Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL);
    await brokerPublish('t/co1/level', '12');
    await waitFor(() => level.value === 12);
  });
});

describe('weatherStation', () => {
  it('builds temperature, humidity, air pressure, light and Eve weather services', async () => {
    const sub = waitForSubscription('t/ws1/condition');
    const subWind = waitForSubscription('t/ws1/windspeed');
    const { accessory } = makeAccessory(
      {
        type: 'weatherStation',
        name: 'Ws1',
        url,
        serviceNames: { temperature: 'Outdoor Temp' },
        topics: {
          getCurrentTemperature: 't/ws1/temperature',
          getCurrentRelativeHumidity: 't/ws1/humidity',
          getAirPressure: 't/ws1/pressure',
          getCurrentAmbientLightLevel: 't/ws1/light',
          getWeatherCondition: 't/ws1/condition',
          getRain1h: 't/ws1/rain1h',
          getRain24h: 't/ws1/rain24h',
          getUVIndex: 't/ws1/uv',
          getVisibility: 't/ws1/visibility',
          getWindDirection: 't/ws1/winddir',
          getWindSpeed: 't/ws1/windspeed',
          getmaxWind: 't/ws1/maxwind',
          getDewPoint: 't/ws1/dewpoint',
        },
      },
      api,
    );
    const services = accessory.getServices();
    const tempSvc = services.find((s) => s instanceof Service.TemperatureSensor)!;
    expect(tempSvc).toBeDefined();
    expect(tempSvc.displayName).toBe('Outdoor Temp'); // svcNames.temperature
    const humSvc = services.find((s) => s instanceof Service.HumiditySensor)!;
    expect(humSvc.displayName).toBe('Ws1 Humidity');
    const presSvc = services.find((s) => s.UUID === eve.Services.AirPressureSensor.UUID)!;
    expect(presSvc).toBeDefined();
    expect(presSvc.displayName).toBe('Ws1 AirPressure');
    const lightSvc = services.find((s) => s instanceof Service.LightSensor)!;
    expect(lightSvc.displayName).toBe('Ws1 Light Level');
    const weatherSvc = services.find((s) => s.UUID === WEATHER_SERVICE_UUID)!;
    expect(weatherSvc).toBeDefined();
    expect(weatherSvc.displayName).toBe('Ws1 Weather');
    for (const c of [
      eve.Characteristics.Condition,
      eve.Characteristics.Rain1h,
      eve.Characteristics.Rain24h,
      eve.Characteristics.UvIndex,
      eve.Characteristics.Visibility,
      eve.Characteristics.WindDirection,
      eve.Characteristics.WindSpeed,
      eve.Characteristics.MaximumWindSpeed,
      eve.Characteristics.DewPoint,
    ]) {
      expect(weatherSvc.testCharacteristic(c as never)).toBe(true);
    }
    await sub;
    await subWind;
    await brokerPublish('t/ws1/condition', 'Cloudy');
    await waitFor(() => weatherSvc.getCharacteristic(eve.Characteristics.Condition as never).value === 'Cloudy');
    await brokerPublish('t/ws1/windspeed', '5.5');
    await waitFor(() => weatherSvc.getCharacteristic(eve.Characteristics.WindSpeed as never).value === 5.5);
  });
});

describe('television', () => {
  it('builds television, speaker and linked input sources', async () => {
    const sub = waitForSubscription('t/tv1/input/get');
    const { accessory } = makeAccessory(
      {
        type: 'television',
        name: 'Tv1',
        url,
        inputs: [
          { name: 'HDMI 1', value: 'HDMI1' },
          { name: 'HDMI 2', value: 'HDMI2' },
        ] as never,
        topics: {
          setActive: 't/tv1/active/set',
          getActive: 't/tv1/active/get',
          setActiveInput: 't/tv1/input/set',
          getActiveInput: 't/tv1/input/get',
          setRemoteKey: 't/tv1/key/set',
        },
      },
      api,
    );
    const services = accessory.getServices();
    const tvSvc = services.find((s) => s instanceof Service.Television)!;
    expect(tvSvc).toBeDefined();
    expect(tvSvc.isPrimaryService).toBe(true);
    const speakerSvc = services.find((s) => s instanceof Service.TelevisionSpeaker)!;
    expect(speakerSvc).toBeDefined();
    expect(speakerSvc.testCharacteristic(Characteristic.VolumeSelector)).toBe(true);
    const inputSvcs = services.filter((s) => s instanceof Service.InputSource);
    expect(inputSvcs).toHaveLength(2);
    expect(inputSvcs[0].getCharacteristic(Characteristic.ConfiguredName).value).toBe('HDMI 1');
    expect(inputSvcs[0].getCharacteristic(Characteristic.IsConfigured).value).toBe(Characteristic.IsConfigured.CONFIGURED);
    for (const inputSvc of inputSvcs) {
      expect(tvSvc.linkedServices).toContain(inputSvc);
    }
    // display order TLV: (1, 1, 1), (1, 1, 2)
    expect(tvSvc.getCharacteristic(Characteristic.DisplayOrder).value).toBe(Buffer.from([1, 1, 1, 1, 1, 2]).toString('base64'));

    // input selection from MQTT
    const activeIdentifier = tvSvc.getCharacteristic(Characteristic.ActiveIdentifier);
    await sub;
    await brokerPublish('t/tv1/input/get', 'HDMI2');
    await waitFor(() => activeIdentifier.value === 2);

    // input selection and remote key from HomeKit
    await activeIdentifier.setValue(1);
    await waitFor(() => seen.some((p) => p.topic === 't/tv1/input/set' && p.payload === 'HDMI1'));
    await tvSvc.getCharacteristic(Characteristic.RemoteKey).setValue(Characteristic.RemoteKey.ARROW_UP);
    await waitFor(() => seen.some((p) => p.topic === 't/tv1/key/set' && p.payload === 'UP'));
  });
});

describe('irrigationSystem', () => {
  it('builds the irrigation system with service label and linked zone valves', () => {
    const { accessory } = makeAccessory(
      {
        type: 'irrigationSystem',
        name: 'Irr1',
        url,
        topics: { setActive: 't/irr1/active/set' },
        zones: [
          { name: 'Zone 1', topics: { setActive: 't/irr1/z1/set', getActive: 't/irr1/z1/get', getInUse: 't/irr1/z1/inuse' } },
          { name: 'Zone 2', topics: { setActive: 't/irr1/z2/set', getActive: 't/irr1/z2/get', getInUse: 't/irr1/z2/inuse' } },
        ] as never,
      },
      api,
    );
    const services = accessory.getServices();
    const svc = services.find((s) => s instanceof Service.IrrigationSystem)!;
    expect(svc).toBeDefined();
    expect(svc.isPrimaryService).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Active)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.InUse)).toBe(true);
    expect(svc.getCharacteristic(Characteristic.ProgramMode).value).toBe(Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED);
    const labelSvc = services.find((s) => s instanceof Service.ServiceLabel)!;
    expect(labelSvc).toBeDefined();
    expect(labelSvc.getCharacteristic(Characteristic.ServiceLabelNamespace).value).toBe(
      Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS,
    );
    const valves = services.filter((s) => s instanceof Service.Valve);
    expect(valves).toHaveLength(2);
    valves.forEach((valveSvc, index) => {
      expect(valveSvc.getCharacteristic(Characteristic.ValveType).value).toBe(Characteristic.ValveType.IRRIGATION);
      expect(valveSvc.getCharacteristic(Characteristic.ServiceLabelIndex).value).toBe(index + 1);
      expect(valveSvc.testCharacteristic(Characteristic.SetDuration)).toBe(true);
      expect(valveSvc.testCharacteristic(Characteristic.RemainingDuration)).toBe(true);
      expect(valveSvc.getCharacteristic(Characteristic.IsConfigured).value).toBe(Characteristic.IsConfigured.CONFIGURED);
      expect(svc.linkedServices).toContain(valveSvc);
    });
    // default SetDuration is 1200
    expect(valves[0].getCharacteristic(Characteristic.SetDuration).value).toBe(1200);
  });

  it('activates the main service when a zone valve activates from MQTT', async () => {
    const sub = waitForSubscription('t/irr2/z1/get');
    const { accessory } = makeAccessory(
      {
        type: 'irrigationSystem',
        name: 'Irr2',
        url,
        topics: { setActive: 't/irr2/active/set' },
        zones: [{ name: 'Zone 1', topics: { setActive: 't/irr2/z1/set', getActive: 't/irr2/z1/get' } }] as never,
      },
      api,
    );
    const services = accessory.getServices();
    const svc = services.find((s) => s instanceof Service.IrrigationSystem)!;
    const valveSvc = services.find((s) => s instanceof Service.Valve)!;
    const valveActive = valveSvc.getCharacteristic(Characteristic.Active);
    const mainActive = svc.getCharacteristic(Characteristic.Active);
    await sub;
    await brokerPublish('t/irr2/z1/get', 'true');
    await waitFor(() => valveActive.value === Characteristic.Active.ACTIVE);
    // linked characteristics propagate to the main service, which publishes
    await waitFor(() => mainActive.value === Characteristic.Active.ACTIVE);
    await waitFor(() => seen.some((p) => p.topic === 't/irr2/active/set' && p.payload === 'true'));
  });

  it('publishes to the zone setActive topic when HomeKit opens a valve', async () => {
    const { accessory } = makeAccessory(
      {
        type: 'irrigationSystem',
        name: 'Irr3',
        url,
        topics: {},
        zones: [{ name: 'Zone 1', topics: { setActive: 't/irr3/z1/set', getActive: 't/irr3/z1/get' } }] as never,
      },
      api,
    );
    const valveSvc = accessory.getServices().find((s) => s instanceof Service.Valve)!;
    await valveSvc.getCharacteristic(Characteristic.Active).setValue(Characteristic.Active.ACTIVE);
    await waitFor(() => seen.some((p) => p.topic === 't/irr3/z1/set' && p.payload === 'true'));
  });
});
