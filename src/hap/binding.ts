// Characteristic binding layer: the modernized equivalent of upstream's
// closure helpers (index.js:343-541, 1174-1326).
//
// Modernization notes (behavior-preserving):
// - legacy .on('get')/.on('set') callbacks become onGet/onSet promise
//   handlers; the offline state maps to a thrown HapStatusError
//   (SERVICE_COMMUNICATION_FAILURE), which the Home app shows as
//   "No Response" exactly like upstream's callback('offline').
// - upstream's c_mySetContext sentinel is gone: MQTT-driven updates use
//   Characteristic.updateValue(), which notifies HomeKit without invoking
//   onSet, so there is no feedback loop to guard against.
// - direct charac.props mutation becomes setProps(), guarded so invalid
//   user-supplied ranges degrade to a warning instead of dropping the
//   whole accessory.
import { EventEmitter } from 'node:events';

import type { CharacteristicValue, Controller, HAP, Service } from 'homebridge';

import type { ThingConfig, TopicSpec } from '../config.js';
import type { Log } from '../log.js';
import { makeConfirmedPublisher, type Publisher } from '../mqtt/confirmation.js';
import type { MessageHandler, MqttContext } from '../mqtt/context.js';
import { publish as mqttPublish, subscribe as mqttSubscribe } from '../mqtt/wiring.js';
import { makeEve, type EveTypes } from './eve.js';
import {
  isRecvValueOff,
  isRecvValueOn,
  isRecvValueOnline,
  isRecvValueOffline,
  getOnOffPubValue,
  mapValueForHomebridge,
  type MapValueFunc,
} from './values.js';

// Whatever service.getCharacteristic() accepts (constructor or name).
export type CharacteristicSelector = Parameters<Service['getCharacteristic']>[0];
export type BoundCharacteristic = NonNullable<ReturnType<Service["getCharacteristic"]>>;

/**
 * Per-service-config binding context: the explicit replacement for
 * upstream's configToServices() closure state. For "custom" multi-service
 * accessories a fresh ThingContext (with fresh state/events) is created per
 * sub-service, sharing the accessory-wide MqttContext, controllers array,
 * and adaptive-lighting bookkeeping rules.
 */
export interface ThingContext {
  mqttCtx: MqttContext;
  config: ThingConfig;
  log: Log;
  hap: HAP;
  eve: EveTypes;
  state: Record<string, unknown>;
  events: Record<string, () => void>;
  controllers: Controller[];
  adaptiveLightingEmitter: EventEmitter;

  raiseEvent(property: string): void;
  subscribe(topic: TopicSpec, property: string, handler: MessageHandler): void;
  publish(topic: TopicSpec | undefined, property: string, message: unknown): void;
  confirmedPublisher(
    setTopic: TopicSpec | undefined,
    getTopic: TopicSpec | undefined,
    property: string,
    makeConfirmed?: boolean,
  ): Publisher;
  throttledCall(func: () => void, identifier: string, timeout: number): void;
  isOffline(): boolean;

  isAdaptiveLightingActive(): boolean;
  disableAdaptiveLighting(what: string): void;
  supportAdaptiveLighting(): boolean;
  addAdaptiveLightingController(service: Service): void;
}

export interface MakeThingContextParams {
  mqttCtx: MqttContext;
  config: ThingConfig;
  log: Log;
  hap: HAP;
  controllers: Controller[];
  /** api.versionGreaterOrEqual, used to gate adaptive lighting like upstream */
  versionGreaterOrEqual?: (version: string) => boolean;
  /** shared throttledCall timer map (accessory-scoped, like upstream) */
  throttledCallTimers: Record<string, NodeJS.Timeout | null>;
}

export function makeThingContext(params: MakeThingContextParams): ThingContext {
  const { mqttCtx, config, log, hap, controllers, versionGreaterOrEqual, throttledCallTimers } = params;

  // fresh per-(sub-)service state, shared with the MQTT layer via ctx.state
  // (upstream index.js:185: `var state = ctx.state = {}`)
  const state: Record<string, unknown> = (mqttCtx.state = {});
  const events: Record<string, () => void> = {};

  let adaptiveLightingController: InstanceType<HAP['AdaptiveLightingController']> | null = null;
  const adaptiveLightingEmitter = new EventEmitter();

  const thing: ThingContext = {
    mqttCtx,
    config,
    log,
    hap,
    eve: makeEve(hap),
    state,
    events,
    controllers,
    adaptiveLightingEmitter,

    raiseEvent(property) {
      if (Object.prototype.hasOwnProperty.call(events, property)) {
        events[property]();
      }
    },
    subscribe(topic, property, handler) {
      mqttSubscribe(mqttCtx, topic, property, handler);
    },
    publish(topic, property, message) {
      mqttPublish(mqttCtx, topic, property, message);
    },
    confirmedPublisher(setTopic, getTopic, property, makeConfirmed) {
      return makeConfirmedPublisher(mqttCtx, setTopic, getTopic, property, makeConfirmed);
    },
    throttledCall(func, identifier, timeout) {
      const existing = throttledCallTimers[identifier];
      if (existing) {
        clearTimeout(existing);
      }
      throttledCallTimers[identifier] = setTimeout(() => {
        throttledCallTimers[identifier] = null;
        func();
      }, timeout);
    },
    isOffline() {
      return state.online === false;
    },

    isAdaptiveLightingActive() {
      return !!adaptiveLightingController && adaptiveLightingController.isAdaptiveLightingActive();
    },
    disableAdaptiveLighting(what) {
      if (thing.isAdaptiveLightingActive()) {
        log(`External control (${what}) disabling adaptive lighting`);
        adaptiveLightingController!.disableAdaptiveLighting();
      }
    },
    supportAdaptiveLighting() {
      return config.adaptiveLighting !== false && !!versionGreaterOrEqual && versionGreaterOrEqual('1.3.0-beta.27');
    },
    addAdaptiveLightingController(service) {
      if (adaptiveLightingController) {
        log.error('Logic error: Duplicate call to addAdaptiveLightingController() - ignoring');
        return;
      }
      log('Enabling adaptive lighting');
      adaptiveLightingController = new hap.AdaptiveLightingController(service as never, {
        controllerMode: hap.AdaptiveLightingControllerMode.AUTOMATIC,
      });
      controllers.push(adaptiveLightingController as unknown as Controller);
    },
  };
  return thing;
}

function isSet(val: unknown): boolean {
  return val !== undefined && val !== null;
}

/** Value validation ported verbatim from upstream index.js:293-341. */
export function isValid(thing: ThingContext, charac: BoundCharacteristic, value: unknown): boolean {
  const { config, log } = thing;

  // if validation is disabled, accept anything
  if (config.validate === false) {
    return true;
  }

  const props = charac.props;
  const format = props.format as string;
  if (format === 'int' || format === 'uint8' || format === 'uint16' || format === 'uint32') {
    if (!Number.isInteger(value)) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - not an integer`);
      return false;
    }
    if (isSet(props.minValue) && (value as number) < props.minValue!) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - below minimum (${props.minValue})`);
      return false;
    }
    if (isSet(props.maxValue) && (value as number) > props.maxValue!) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - above maximum (${props.maxValue})`);
      return false;
    }
  } else if (format === 'float') {
    if (typeof value !== 'number' || isNaN(value)) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - not a number`);
      return false;
    }
    if (isSet(props.minValue) && value < props.minValue!) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - below minimum (${props.minValue})`);
      return false;
    }
    if (isSet(props.maxValue) && value > props.maxValue!) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - above maximum (${props.maxValue})`);
      return false;
    }
  } else if (format === 'bool') {
    if (value !== true && value !== false) {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - not a Boolean`);
      return false;
    }
  } else if (format === 'string') {
    if (typeof value !== 'string') {
      log(`Ignoring invalid value [${value}] for ${charac.displayName} - not a string`);
      return false;
    }
  } else {
    log(`Unable to validate ${charac.displayName}, format [${format}] - ${JSON.stringify(charac)}`);
  }
  return true;
}

/**
 * Push a plugin-driven value to HomeKit. updateValue() notifies subscribers
 * without triggering onSet — the modern equivalent of upstream's
 * setValue(value, undefined, c_mySetContext).
 */
export function setCharacteristic(thing: ThingContext, charac: BoundCharacteristic, value: unknown): void {
  if (isValid(thing, charac, value)) {
    charac.updateValue(value as CharacteristicValue);
  }
}

/** Register an onGet handler with upstream's offline -> "No Response" behavior. */
function bindGet(thing: ThingContext, charac: BoundCharacteristic, getValue: () => unknown): void {
  charac.onGet(() => {
    if (thing.isOffline()) {
      throw new thing.hap.HapStatusError(thing.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return getValue() as CharacteristicValue;
  });
}

/** setProps wrapper degrading invalid user ranges to a warning. */
function setNumericProps(
  thing: ThingContext,
  charac: BoundCharacteristic,
  props: { minValue?: number; maxValue?: number },
): void {
  try {
    charac.setProps(props);
  } catch (ex) {
    thing.log.warn(`Ignoring invalid characteristic properties ${JSON.stringify(props)} for ${charac.displayName} - ${ex}`);
  }
}

export interface BooleanCharacteristicOptions {
  initialValue?: boolean;
  mapValueFunc?: MapValueFunc | null;
  turnOffAfterms?: number;
  resetStateAfterms?: number;
  enableConfirmation?: boolean;
}

/** Boolean characteristic binding (upstream index.js:349-422). */
export function booleanCharacteristic(
  thing: ThingContext,
  service: Service,
  property: string,
  characteristic: CharacteristicSelector,
  setTopic: TopicSpec | undefined,
  getTopic: TopicSpec | undefined,
  opts: BooleanCharacteristicOptions = {},
): void {
  const { state, config } = thing;
  const { initialValue, mapValueFunc, turnOffAfterms, resetStateAfterms, enableConfirmation } = opts;

  const publish = thing.confirmedPublisher(setTopic, getTopic, property, enableConfirmation);

  // auto-turn-off and reset-state timers
  let autoOffTimer: NodeJS.Timeout | null = null;
  let autoResetStateTimer: NodeJS.Timeout | null = null;

  // default state
  state[property] = initialValue ? true : false;

  // set up characteristic
  const charac = service.getCharacteristic(characteristic)!;
  bindGet(thing, charac, () => mapValueForHomebridge(state[property] as boolean, mapValueFunc));
  if (setTopic) {
    charac.onSet((value) => {
      state[property] = value;
      publish(getOnOffPubValue(config, value as boolean));

      // optionally turn off after timeout
      if (value && turnOffAfterms) {
        if (autoOffTimer) {
          clearTimeout(autoOffTimer);
        }
        autoOffTimer = setTimeout(() => {
          autoOffTimer = null;

          state[property] = false;
          publish(getOnOffPubValue(config, false));
          setCharacteristic(thing, charac, mapValueForHomebridge(false, mapValueFunc));
        }, turnOffAfterms);
      }
    });
  }
  if (initialValue) {
    setCharacteristic(thing, charac, mapValueForHomebridge(initialValue, mapValueFunc));
  }

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
      // if it changed, set characteristic
      if (state[property] != newState) {
        state[property] = newState;
        setCharacteristic(thing, charac, mapValueForHomebridge(newState, mapValueFunc));
      }
      // optionally reset state to OFF after a timeout
      if (newState && resetStateAfterms) {
        if (autoResetStateTimer) {
          clearTimeout(autoResetStateTimer);
        }
        autoResetStateTimer = setTimeout(() => {
          autoResetStateTimer = null;
          state[property] = false;
          setCharacteristic(thing, charac, mapValueForHomebridge(false, mapValueFunc));
        }, resetStateAfterms);
      }
    });
  }
}

/** Track a boolean in state from MQTT without a characteristic (index.js:424-438). */
export function booleanState(
  thing: ThingContext,
  property: string,
  getTopic: TopicSpec | undefined,
  initialValue: boolean,
  isOnFunc: (message: unknown) => boolean,
  isOffFunc: (message: unknown) => boolean,
): void {
  const { state } = thing;
  // default state
  state[property] = initialValue ? true : false;

  // MQTT subscription
  if (getTopic) {
    thing.subscribe(getTopic, property, (_topic, message) => {
      if (isOnFunc(message)) {
        state[property] = true;
      } else if (isOffFunc(message)) {
        state[property] = false;
      }
    });
  }
}

/** Track the online state from the getOnline topic (index.js:440-442). */
export function stateOnline(thing: ThingContext): void {
  booleanState(
    thing,
    'online',
    thing.config.topics?.getOnline,
    true,
    (m) => isRecvValueOnline(thing.config, m),
    (m) => isRecvValueOffline(thing.config, m),
  );
}

export interface IntegerCharacteristicOptions {
  initialValue?: number;
  minValue?: number;
  maxValue?: number;
  onSet?: (value: CharacteristicValue) => void;
  onMqtt?: (value: number) => void;
}

/** Integer characteristic binding (upstream index.js:444-507). */
export function integerCharacteristic(
  thing: ThingContext,
  service: Service,
  property: string,
  characteristic: CharacteristicSelector,
  setTopic: TopicSpec | undefined,
  getTopic: TopicSpec | undefined,
  options: IntegerCharacteristicOptions = {},
): { onSet: (value: CharacteristicValue) => void } {
  const { state } = thing;
  const { initialValue, minValue, maxValue } = options;

  // default state
  state[property] = initialValue || 0;

  // set up characteristic
  const charac = service.getCharacteristic(characteristic)!;

  // min/max
  const props: { minValue?: number; maxValue?: number } = {};
  if (Number.isInteger(minValue)) {
    props.minValue = minValue;
  }
  if (Number.isInteger(maxValue)) {
    props.maxValue = maxValue;
  }
  if (props.minValue !== undefined || props.maxValue !== undefined) {
    setNumericProps(thing, charac, props);
  }

  bindGet(thing, charac, () => state[property]);

  const onSet = (value: CharacteristicValue) => {
    state[property] = value;
    if (setTopic) {
      thing.publish(setTopic, property, value);
    }
    if (options.onSet) {
      options.onSet(value);
    }
  };

  if (setTopic || options.onSet) {
    charac.onSet((value) => {
      onSet(value);
    });
  }
  if (initialValue) {
    setCharacteristic(thing, charac, initialValue);
  }

  // subscribe to get topic
  if (getTopic) {
    thing.subscribe(getTopic, property, (_topic, message) => {
      const newState = parseInt(String(message));
      if (state[property] != newState) {
        if (options.onMqtt) {
          options.onMqtt(newState);
        }
        // update state and characteristic
        state[property] = newState;
        setCharacteristic(thing, charac, newState);
      }
    });
  }

  return { onSet };
}

export interface FloatCharacteristicOptions {
  initialValue?: number;
  minValue?: number;
  maxValue?: number;
}

/** Float characteristic binding (upstream index.js:1174-1232). */
export function floatCharacteristic(
  thing: ThingContext,
  service: Service,
  property: string,
  characteristic: CharacteristicSelector,
  setTopic: TopicSpec | undefined,
  getTopic: TopicSpec | undefined,
  optionsIn?: number | FloatCharacteristicOptions,
): void {
  const { state } = thing;

  let options: FloatCharacteristicOptions;
  if (optionsIn === undefined) {
    options = {};
  } else if (typeof optionsIn === 'number') {
    options = { initialValue: optionsIn };
  } else {
    options = optionsIn;
  }
  let initialValue = options.initialValue || 0;

  // set up characteristic
  const charac = service.getCharacteristic(characteristic)!;

  const props: { minValue?: number; maxValue?: number } = {};
  if (options.minValue !== undefined) {
    props.minValue = options.minValue;
  }
  if (options.maxValue !== undefined) {
    props.maxValue = options.maxValue;
  }
  if (props.minValue !== undefined || props.maxValue !== undefined) {
    setNumericProps(thing, charac, props);
  }

  if (charac.props.minValue !== undefined && charac.props.minValue !== null && initialValue < charac.props.minValue) {
    initialValue = charac.props.minValue;
  }
  if (charac.props.maxValue !== undefined && charac.props.maxValue !== null && initialValue > charac.props.maxValue) {
    initialValue = charac.props.maxValue;
  }

  // default state
  state[property] = initialValue;

  bindGet(thing, charac, () => state[property]);
  if (setTopic) {
    charac.onSet((value) => {
      state[property] = value;
      thing.publish(setTopic, property, value);
    });
  }
  if (initialValue) {
    setCharacteristic(thing, charac, initialValue);
  }

  // subscribe to get topic
  if (getTopic) {
    thing.subscribe(getTopic, property, (_topic, message) => {
      const newState = parseFloat(String(message));
      if (state[property] != newState) {
        state[property] = newState;
        setCharacteristic(thing, charac, newState);
      }
    });
  }
}

/** String characteristic binding (upstream index.js:1234-1263). */
export function stringCharacteristic(
  thing: ThingContext,
  service: Service,
  property: string,
  characteristic: CharacteristicSelector,
  setTopic: TopicSpec | undefined,
  getTopic: TopicSpec | undefined,
  initialValue?: string,
): void {
  const { state } = thing;
  // default state
  state[property] = initialValue ? initialValue : '';

  // set up characteristic
  const charac = service.getCharacteristic(characteristic)!;
  bindGet(thing, charac, () => state[property]);
  if (setTopic) {
    charac.onSet((value) => {
      state[property] = value;
      thing.publish(setTopic, property, value);
    });
  }

  // subscribe to get topic
  if (getTopic) {
    thing.subscribe(getTopic, property, (_topic, message) => {
      const newState = String(message);
      if (state[property] !== newState) {
        state[property] = newState;
        setCharacteristic(thing, charac, newState);
      }
    });
  }
}

/** Enum characteristic binding via a value mapping array (index.js:1265-1326). */
export function multiCharacteristic(
  thing: ThingContext,
  service: Service,
  property: string,
  characteristic: CharacteristicSelector,
  setTopic: TopicSpec | undefined,
  getTopic: TopicSpec | undefined,
  values: unknown[],
  initialValue?: number,
  eventOnly?: boolean,
): void {
  const { state, config, log } = thing;

  // Values is an array of MQTT values indexed by <value of Homekit enumeration>.
  // Build map of MQTT values to homekit values
  const mqttToHomekit: Record<string, number> = {};
  for (let i = 0; i < values.length; i++) {
    mqttToHomekit[String(values[i])] = i;
  }

  state[property] = initialValue;

  const charac = service.getCharacteristic(characteristic)!;

  // Homekit get
  if (!eventOnly) {
    bindGet(thing, charac, () => state[property]);
  }

  // Homekit set
  if (setTopic) {
    charac.onSet((valueIn) => {
      let value: CharacteristicValue = valueIn;
      if (typeof value === 'boolean') {
        value = value ? 1 : 0;
      }

      state[property] = value;
      const mqttVal = values[value as number];
      if (mqttVal !== undefined) {
        thing.publish(setTopic, property, mqttVal);
      }
      thing.raiseEvent(property);
    });
  }

  if (initialValue) {
    setCharacteristic(thing, charac, initialValue);
  }

  // MQTT set (Homekit get)
  if (getTopic) {
    thing.subscribe(getTopic, property, (_topic, message) => {
      const data = message?.toString() ?? '';
      const newState = mqttToHomekit[data];
      if (newState !== undefined && (eventOnly || state[property] != newState)) {
        if (config.logMqtt) {
          log(`Received ${data} - ${property} state is now ${newState}`);
        }
        state[property] = newState;
        setCharacteristic(thing, charac, newState);
        thing.raiseEvent(property);
      }
      if (newState === undefined && config.logMqtt) {
        log(`Warning: ${property} received [${data}] which is not in configured values ${JSON.stringify(mqttToHomekit)}`);
      }
    });
  }
}

/** Generic state-backed characteristic (upstream index.js:509-541). */
export function addCharacteristic(
  thing: ThingContext,
  service: Service,
  property: string,
  characteristic: CharacteristicSelector,
  defaultValue: unknown,
  characteristicChanged?: () => void,
  adaptiveEventName?: string,
): void {
  const { state } = thing;

  state[property] = defaultValue;

  const charac = service.getCharacteristic(characteristic)!;

  setCharacteristic(thing, charac, defaultValue);

  bindGet(thing, charac, () => {
    let valReturned = state[property];
    if (!isValid(thing, charac, valReturned)) {
      valReturned = defaultValue;
    }
    return valReturned;
  });

  if (characteristicChanged) {
    charac.onSet((value) => {
      state[property] = value;
      characteristicChanged();
    });

    if (adaptiveEventName) {
      thing.adaptiveLightingEmitter.addListener(adaptiveEventName, (value) => {
        state[property] = value;
        characteristicChanged();
      });
    }
  }
}
