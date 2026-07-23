// On/off and online/offline value mapping, ported from upstream
// index.js:200-267. All comparison quirks (loose string equality, the
// onValue truthiness gate, otherValueOff, missing-offValue semantics) are
// compatibility-critical.
import type { ThingConfig } from '../config.js';

/**
 * Appropriate on/off value for a Boolean property (not forced to string) for
 * MQTT publishing. Returns null if there is no off value. Note the upstream
 * truthiness gate: a configured onValue of 0 or '' falls through to
 * integerValue handling.
 */
export function getOnOffPubValue(config: ThingConfig, value: boolean): unknown {
  let mqttval: unknown;
  if (config.onValue) {
    // using onValue/offValue
    mqttval = value ? config.onValue : config.offValue;
  } else if (config.integerValue) {
    mqttval = value ? 1 : 0;
  } else {
    mqttval = value ? true : false;
  }
  if (mqttval === undefined || mqttval === null) {
    return null;
  }
  return mqttval;
}

/** Test whether a received value represents 'on'. */
export function isRecvValueOn(config: ThingConfig, mqttval: unknown): boolean {
  const onval = getOnOffPubValue(config, true);
  return mqttval === onval || mqttval == onval + '';
}

/**
 * Test whether a received value represents 'off'. Since upstream v1.0.23 a
 * Boolean characteristic only turns off on an exact offValue match unless
 * otherValueOff is set.
 */
export function isRecvValueOff(config: ThingConfig, mqttval: unknown): boolean {
  if (config.otherValueOff) {
    if (!isRecvValueOn(config, mqttval)) {
      // it's not the on value and we consider any other value to be off
      return true;
    }
  }

  const offval = getOnOffPubValue(config, false);

  if (offval === null) {
    // there is no off value
    return false;
  }

  if (mqttval === offval || mqttval == offval + '') {
    // off value match - it's definitely off
    return true;
  }

  // not off
  return false;
}

export function getOnlineOfflinePubValue(config: ThingConfig, value: boolean): unknown {
  let pubVal = value ? config.onlineValue : config.offlineValue;
  if (pubVal === undefined) {
    pubVal = getOnOffPubValue(config, value);
  }
  return pubVal;
}

export function isRecvValueOnline(config: ThingConfig, mqttval: unknown): boolean {
  const onval = getOnlineOfflinePubValue(config, true);
  return mqttval === onval || mqttval == onval + '';
}

export function isRecvValueOffline(config: ThingConfig, mqttval: unknown): boolean {
  const offval = getOnlineOfflinePubValue(config, false);
  return mqttval === offval || mqttval == offval + '';
}

export type MapValueFunc = (value: boolean) => unknown;

export function mapValueForHomebridge(val: boolean, mapValueFunc?: MapValueFunc | null): unknown {
  if (mapValueFunc) {
    return mapValueFunc(val);
  }
  return val;
}
