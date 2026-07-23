// Eve app history support via fakegato-history, ported from upstream
// index.js (HistoryOptions/persistence helpers at index.js:134-182 and the
// history_* characteristic loggers at index.js:1334-2496).
//
// fakegato-history is loaded lazily on first use. If it cannot be loaded (or
// a history service cannot be constructed), an error is logged and the
// accessory continues WITHOUT history instead of crashing Homebridge.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { API, Service } from 'homebridge';

import { addCharacteristic, type ThingContext } from '../hap/binding.js';
import type { Log } from '../log.js';

/**
 * Runtime surface of a fakegato-history service instance. fakegato's
 * FakeGatoHistory class extends hap-nodejs' Service, so instances slot
 * directly into an accessory's service list.
 */
export interface FakegatoHistoryService extends Service {
  addEntry(entry: Record<string, unknown>): void;
  getInitialTime(): number;
  lastEntry: number;
  memorySize: number;
  history: Array<{ time?: number } | string | undefined>;
}

type HistoryServiceClass = new (
  accessoryType: string,
  accessory: { displayName: string; log: Log },
  optionalParams: HistoryOptions,
) => FakegatoHistoryService;

/** fakegato-history exports `function(homebridge) { ... return FakeGatoHistory; }`. */
type FakegatoFactory = (homebridge: API) => HistoryServiceClass;

// fakegato-history is a CommonJS module; require it lazily from this ESM
// module so a broken installation degrades to "no history" instead of
// failing to import the whole plugin.
const defaultFakegatoLoader = (): FakegatoFactory => {
  const req = createRequire(import.meta.url);
  return req('fakegato-history') as FakegatoFactory;
};

let fakegatoLoader: () => FakegatoFactory = defaultFakegatoLoader;

/** Test hook: override how fakegato-history is loaded (null restores the default). */
export function setFakegatoLoaderForTesting(loader: (() => FakegatoFactory) | null): void {
  fakegatoLoader = loader ?? defaultFakegatoLoader;
  historyServiceClassCache = new WeakMap();
}

// The loaded HistoryService class, cached per Homebridge API instance
// (upstream: `HistoryService = fakegatoHistory( homebridge )`, index.js:3628).
// A cached null records a failed load, so the error is only logged once.
let historyServiceClassCache = new WeakMap<API, HistoryServiceClass | null>();

function getHistoryServiceClass(thing: ThingContext): HistoryServiceClass | null {
  const { api, log } = thing;
  if (historyServiceClassCache.has(api)) {
    return historyServiceClassCache.get(api) ?? null;
  }
  let klass: HistoryServiceClass | null = null;
  try {
    klass = fakegatoLoader()(api);
  } catch (ex) {
    log.error('Unable to load fakegato-history - continuing without history: ' + ex);
  }
  historyServiceClassCache.set(api, klass);
  return klass;
}

function logDebug(thing: ThingContext, message: string): void {
  (thing.log as unknown as { debug?: (msg: string) => void }).debug?.(message);
}

// History persistence path (upstream index.js:134-149)
export function historyPersistencePath(thing: ThingContext): string {
  const homebridgePath = thing.api.user.storagePath();
  const persistencePath = thing.config.historyOptions?.persistencePath;
  let directory: string;
  if (persistencePath) {
    if (persistencePath[0] == '/') {
      // full path
      directory = persistencePath;
    } else {
      // assume relative to homebridge path
      directory = path.join(homebridgePath, persistencePath);
    }
  } else {
    // no path configured - use homebridge path
    directory = homebridgePath;
  }
  return directory;
}

// Counter persistence file (upstream index.js:151-154)
export function historyCounterFile(thing: ThingContext): string {
  const counterFile = path.join(historyPersistencePath(thing), os.hostname().split('.')[0] + '_' + thing.config.name + '_cnt_persist.json');
  return counterFile;
}

// Constructor for fakegato-history options (upstream index.js:159-182)
export class HistoryOptions {
  size: number;
  storage: string;
  path?: string;
  disableTimer?: boolean;
  disableRepeatLastData?: boolean;

  constructor(thing: ThingContext, isEventSensor = false) {
    const historyOptions = thing.config.historyOptions ?? {};
    // maximum size of stored data points
    this.size = historyOptions.size || 4032;
    // data will be stored in .homebridge or path specified with homebridge -U option
    this.storage = 'fs';
    if (historyOptions.persistencePath) {
      this.path = historyPersistencePath(thing);
    }
    if (historyOptions.noAutoTimer === true || historyOptions.mergeInterval) {
      // disable averaging (and repeating) interval timer
      // if mergeInterval is used, then autoTimer has to be deactivated (inconsistencies possible)
      this.disableTimer = true;
    }
    // disable repetition (if no data was received in last interval)
    if (historyOptions.noAutoRepeat === true) {
      if (isEventSensor) {
        // for 'motion' and 'door' type
        this.disableTimer = true;
      } else {
        // for 'weather', 'room' and 'energy' type
        this.disableRepeatLastData = true;
      }
    }
  }
}

// F5 (upstream #605): fakegato-history always constructs its service with the
// fixed UUID E863F007-079E-48FF-8F27-9C2605A29F52 and NO subtype (the
// constructor offers no way to pass one through to hap-nodejs' Service), so a
// "custom" accessory with several history-enabled sub-services produced
// colliding services and HAP refused to start (upstream #605, #201). The
// instances are ordinary HAP services whose `subtype` is only read once the
// service is added to the accessory, so from the SECOND history service of an
// accessory onwards a unique subtype is assigned after construction. The
// first history service keeps upstream's no-subtype form, leaving existing
// single-history accessories exactly as before.
const usedHistorySubtypes = new WeakMap<object, Set<string | undefined>>();

function applyHistorySubtype(thing: ThingContext, historySvc: FakegatoHistoryService): void {
  // thing.mqttCtx is shared by all sub-services of an accessory, making it
  // the accessory-scoped key for collision tracking.
  let used = usedHistorySubtypes.get(thing.mqttCtx);
  if (!used) {
    used = new Set();
    usedHistorySubtypes.set(thing.mqttCtx, used);
  }
  let subtype: string | undefined = undefined;
  if (used.size > 0) {
    // prefer the (sub-)service subtype - "custom" sub-services default it to
    // the sub-service name - and fall back to a counter when it is missing
    // or already taken
    const base = thing.config.subtype !== undefined ? String(thing.config.subtype) : 'history';
    subtype = base;
    for (let n = 2; used.has(subtype); n++) {
      subtype = base + '-' + n;
    }
    historySvc.subtype = subtype;
  }
  used.add(subtype);
}

/**
 * Create a fakegato-history service - the equivalent of upstream's
 * `new HistoryService( kind, { displayName: name, log: log }, historyOptions )`
 * dispatch snippets. Returns null when fakegato-history is unavailable, so
 * callers skip history and the accessory keeps working.
 */
export function makeHistoryService(thing: ThingContext, kind: string, isEventSensor = false): FakegatoHistoryService | null {
  const { config, log } = thing;
  const HistoryService = getHistoryServiceClass(thing);
  if (!HistoryService) {
    log.warn('History is unavailable - continuing without history');
    return null;
  }
  try {
    const historyOptions = new HistoryOptions(thing, isEventSensor);
    const historySvc = new HistoryService(kind, { displayName: config.name, log }, historyOptions);
    // F5 (upstream #605)
    applyHistorySubtype(thing, historySvc);
    return historySvc;
  } catch (ex) {
    log.error('Unable to create history service - continuing without history: ' + ex);
    return null;
  }
}

// Add Eve.Characteristics.LastActivation for History (upstream index.js:1475-1488)
export function characteristic_LastActivation(thing: ThingContext, historySvc: FakegatoHistoryService, service: Service): void {
  const { eve } = thing;
  service.addOptionalCharacteristic(eve.Characteristics.LastActivation); // to avoid warnings
  // get lastActivation time from history data (check 5s later to make sure the history is loaded)
  // (unref: this startup check must never keep the process alive on its own)
  setTimeout(() => {
    if (historySvc.lastEntry && historySvc.memorySize) {
      const entry = historySvc.history[historySvc.lastEntry % historySvc.memorySize];
      if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'time')) {
        const lastTime = (entry as { time: number }).time - historySvc.getInitialTime();
        addCharacteristic(thing, service, 'lastActivation', eve.Characteristics.LastActivation, lastTime);
        logDebug(thing, 'lastActivation time loaded');
      }
    }
  }, 5000).unref?.();
}

// History for On (Eve-only) (upstream index.js:1334-1350)
export function history_On(thing: ThingContext, historySvc: FakegatoHistoryService, service: Service): void {
  const { state, eve, hap } = thing;
  characteristic_LastActivation(thing, historySvc, service);

  // get characteristic to be logged
  const charac = service.getCharacteristic(hap.Characteristic.On)!;
  // attach change callback for this characteristic
  charac.on('change', (obj) => {
    const logEntry = {
      time: Math.floor(Date.now() / 1000), // seconds (UTC)
      status: obj.newValue ? 1 : 0, // fakegato-history logProperty 'status' for switch
    };
    historySvc.addEntry(logEntry);
    // update Eve's Characteristic.LastActivation
    state.lastActivation = logEntry.time - historySvc.getInitialTime();
    service.updateCharacteristic(eve.Characteristics.LastActivation, state.lastActivation as number);
  });
}

// History for MotionDetected (upstream index.js:1491-1533)
export function history_MotionDetected(thing: ThingContext, historySvc: FakegatoHistoryService, service: Service): void {
  const { config, state, eve, hap } = thing;
  let historyMergeTimer: NodeJS.Timeout | null = null;
  characteristic_LastActivation(thing, historySvc, service);

  // get characteristic to be logged
  const charac = service.getCharacteristic(hap.Characteristic.MotionDetected)!;
  // attach change callback for this characteristic
  charac.on('change', (obj) => {
    const logEntry = {
      time: Math.floor(Date.now() / 1000), // seconds (UTC)
      status: obj.newValue ? 1 : 0, // fakegato-history logProperty 'status' for motion sensor
    };
    // update Eve's Characteristic.LastActivation
    state.lastActivation = logEntry.time - historySvc.getInitialTime();
    service.updateCharacteristic(eve.Characteristics.LastActivation, state.lastActivation as number);

    const mergeInterval = Number(config.historyOptions?.mergeInterval) * 60000 || 0;
    if (logEntry.status) {
      if (historyMergeTimer) {
        // reset timer -> discard off-event
        clearTimeout(historyMergeTimer);
        historyMergeTimer = null;
      }
      historySvc.addEntry(logEntry);
    } else {
      if (historyMergeTimer) {
        // reset timer
        clearTimeout(historyMergeTimer);
      }
      if (mergeInterval > 0) {
        // log off-event later (with original time),
        // if there is no new on-event in the given time.
        historyMergeTimer = setTimeout(() => {
          historyMergeTimer = null;
          historySvc.addEntry(logEntry);
        }, mergeInterval);
      } else {
        historySvc.addEntry(logEntry);
      }
    }
  });
}

// History for CurrentTemperature (Eve-only) (upstream index.js:1607-1619)
export function history_CurrentTemperature(thing: ThingContext, historySvc: FakegatoHistoryService): void {
  const { config } = thing;
  if (config.topics?.getCurrentTemperature) {
    // additional MQTT subscription instead of set-callback due to correct averaging:
    thing.subscribe(config.topics.getCurrentTemperature, 'currentTemperature', (_topic, message) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        temp: parseFloat(String(message)), // fakegato-history logProperty 'temp' for temperature sensor
      };
      historySvc.addEntry(logEntry);
    });
  }
}

// History for CurrentRelativeHumidity (Eve-only) (upstream index.js:1678-1690)
export function history_CurrentRelativeHumidity(thing: ThingContext, historySvc: FakegatoHistoryService): void {
  const { config } = thing;
  if (config.topics?.getCurrentRelativeHumidity) {
    // additional MQTT subscription instead of set-callback due to correct averaging:
    thing.subscribe(config.topics.getCurrentRelativeHumidity, 'currentRelativeHumidity', (_topic, message) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        humidity: parseFloat(String(message)), // fakegato-history logProperty 'humidity' for humidity sensor
      };
      historySvc.addEntry(logEntry);
    });
  }
}

// History for AirPressure (Eve-only) (upstream index.js:1699-1712)
export function history_AirPressure(thing: ThingContext, historySvc: FakegatoHistoryService): void {
  const { config } = thing;
  if (config.topics?.getAirPressure) {
    // additional MQTT subscription instead of set-callback due to correct averaging:
    thing.subscribe(config.topics.getAirPressure, 'airPressure', (_topic, message) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        pressure: parseFloat(String(message)), // fakegato-history logProperty 'pressure' for air pressure sensor
      };
      historySvc.addEntry(logEntry);
    });
  }
}

// History for ContactSensorState (Eve-only) (upstream index.js:1776-1838)
export function history_ContactSensorState(thing: ThingContext, historySvc: FakegatoHistoryService, service: Service): void {
  const { state, eve, hap, log } = thing;
  characteristic_LastActivation(thing, historySvc, service);

  // get characteristic to be logged
  const charac = service.getCharacteristic(hap.Characteristic.ContactSensorState)!;

  // counterFile for saving 'timesOpened' and 'resetTotal'
  const counterFile = historyCounterFile(thing);

  function writeCounterFile(): void {
    const saveObj = { timesOpened: state.timesOpened, resetTotal: state.resetTotal };
    fs.writeFile(counterFile, JSON.stringify(saveObj), 'utf8', (err) => {
      if (err) {
        log('Error: cannot write file to save timesOpened');
      }
    });
  }

  // load TimesOpened counter from counterFile
  fs.readFile(counterFile, 'utf8', (err, data) => {
    let cnt = 0;
    let res = Math.floor(Date.now() / 1000) - 978307200; // seconds since 01.01.2001
    if (err) {
      logDebug(thing, 'No data loaded for TimesOpened');
    } else {
      cnt = JSON.parse(data).timesOpened;
      res = JSON.parse(data).resetTotal;
    }
    service.addOptionalCharacteristic(eve.Characteristics.TimesOpened); // to avoid warnings
    addCharacteristic(thing, service, 'timesOpened', eve.Characteristics.TimesOpened, cnt);
    historySvc.addOptionalCharacteristic(eve.Characteristics.ResetTotal); // to avoid warnings
    addCharacteristic(thing, historySvc, 'resetTotal', eve.Characteristics.ResetTotal, res, () => {
      state.timesOpened = 0; // reset counter
      service.updateCharacteristic(eve.Characteristics.TimesOpened, 0);
      writeCounterFile();
      log('Reset TimesOpened to 0');
    });

    // these ones are necessary to display history for contact sensors
    service.addOptionalCharacteristic(eve.Characteristics.OpenDuration); // to avoid warnings
    addCharacteristic(thing, service, 'openDuration', eve.Characteristics.OpenDuration, 0);
    service.addOptionalCharacteristic(eve.Characteristics.ClosedDuration); // to avoid warnings
    addCharacteristic(thing, service, 'closedDuration', eve.Characteristics.ClosedDuration, 0);

    // attach change callback for this characteristic
    charac.on('change', (obj) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        status: obj.newValue as number, // fakegato-history logProperty 'status' for contact sensor
      };
      // update Eve's Characteristic.LastActivation
      state.lastActivation = logEntry.time - historySvc.getInitialTime();
      service.updateCharacteristic(eve.Characteristics.LastActivation, state.lastActivation as number);
      if (logEntry.status) {
        // update Eve's Characteristic.TimesOpened
        state.timesOpened = (state.timesOpened as number) + 1;
        service.updateCharacteristic(eve.Characteristics.TimesOpened, state.timesOpened as number);
        writeCounterFile();
      }
      historySvc.addEntry(logEntry);
    });
  });
}

// History for PowerConsumption (Eve-only) (upstream index.js:2423-2484)
export function history_PowerConsumption(thing: ThingContext, historySvc: FakegatoHistoryService, service: Service): void {
  const { config, state, eve, log } = thing;
  // enable mqttthing energy counter, if there is no getTotalConsumption topic
  const energyCounter = config.topics?.getTotalConsumption ? false : true;
  const lastLogEntry = { time: 0, power: 0 }; // for energyCounter
  // counterFile for saving 'totalConsumption' and 'resetTotal'
  const counterFile = historyCounterFile(thing);

  function writeCounterFile(): void {
    const saveObj = { totalConsumption: state.totalConsumption, resetTotal: state.resetTotal };
    fs.writeFile(counterFile, JSON.stringify(saveObj), 'utf8', (err) => {
      if (err) {
        log('Error: cannot write file to save totalConsumption');
      }
    });
  }

  if (energyCounter) {
    // load TotalConsumption counter from counterFile
    fs.readFile(counterFile, 'utf8', (err, data) => {
      let cnt = 0;
      let res = Math.floor(Date.now() / 1000) - 978307200; // seconds since 01.01.2001
      if (err) {
        logDebug(thing, 'No data loaded for totalConsumption');
      } else {
        cnt = JSON.parse(data).totalConsumption;
        res = JSON.parse(data).resetTotal;
      }
      service.addOptionalCharacteristic(eve.Characteristics.TotalConsumption); // to avoid warnings
      addCharacteristic(thing, service, 'totalConsumption', eve.Characteristics.TotalConsumption, cnt);
      historySvc.addOptionalCharacteristic(eve.Characteristics.ResetTotal); // to avoid warnings
      addCharacteristic(thing, historySvc, 'resetTotal', eve.Characteristics.ResetTotal, res, () => {
        state.totalConsumption = 0; // reset counter
        service.updateCharacteristic(eve.Characteristics.TotalConsumption, 0);
        writeCounterFile();
        log('Reset TotalConsumption to 0');
      });
    });
  }

  if (config.topics?.getWatts) {
    // additional MQTT subscription instead of set-callback due to correct averaging:
    thing.subscribe(config.topics.getWatts, 'watts', (_topic, message) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        power: parseFloat(String(message)), // fakegato-history logProperty 'power' for energy meter
      };
      if (energyCounter) {
        // update Eve's Characteristic.TotalConsumption:
        if (lastLogEntry.time) {
          // energy counter: power * timeDifference (Ws --> kWh)
          state.totalConsumption =
            (state.totalConsumption as number) + (lastLogEntry.power * (logEntry.time - lastLogEntry.time)) / 1000 / 3600;
        }
        lastLogEntry.time = logEntry.time;
        lastLogEntry.power = logEntry.power;
        service.updateCharacteristic(eve.Characteristics.TotalConsumption, state.totalConsumption as number);
        writeCounterFile();
      }
      historySvc.addEntry(logEntry);
    });
  }
}

// History for Air Quality (Eve-only) (upstream index.js:2204-2216)
export function history_AirQualityPPM(thing: ThingContext, historySvc: FakegatoHistoryService): void {
  const { config } = thing;
  if (config.topics?.getAirQualityPPM) {
    // additional MQTT subscription instead of set-callback due to correct averaging:
    thing.subscribe(config.topics.getAirQualityPPM, 'airQualityPPM', (_topic, message) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        ppm: parseFloat(String(message)), // fakegato-history logProperty 'ppm' for air quality sensor
      };
      historySvc.addEntry(logEntry);
    });
  }
}

// History for Air Quality (Eve Room 2 only) (upstream index.js:2219-2230)
export function history_VOCDensity(thing: ThingContext, historySvc: FakegatoHistoryService): void {
  const { config } = thing;
  if (config.topics?.getVOCDensity) {
    // additional MQTT subscription instead of set-callback due to correct averaging:
    thing.subscribe(config.topics.getVOCDensity, 'VOCDensity', (_topic, message) => {
      const logEntry = {
        time: Math.floor(Date.now() / 1000), // seconds (UTC)
        voc: parseFloat(String(message)), // fakegato-history logProperty 'voc' for air quality sensor
      };
      historySvc.addEntry(logEntry);
    });
  }
}
