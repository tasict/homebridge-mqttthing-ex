// Button-style accessory types: doorbell, statelessProgrammableSwitch.
// Ported from upstream index.js dispatch branches (3037-3053, 3068-3106).
import type { Service } from 'homebridge';

import {
  addCharacteristic,
  integerCharacteristic,
  multiCharacteristic,
  setCharacteristic,
  type ThingContext,
} from '../hap/binding.js';
import type { TopicSpec } from '../config.js';
import { characteristic_Volume } from './audio.js';
import { registerServiceType } from './registry.js';
import { characteristic_MotionDetected } from './shared.js';

// Characteristic.ProgrammableSwitchEvent (upstream index.js:1841)
export function characteristic_ProgrammableSwitchEvent(
  thing: ThingContext,
  service: Service,
  property: string,
  getTopic: TopicSpec | undefined,
  switchValues: unknown[] | undefined,
  restrictSwitchValues: number[] | undefined,
): void {
  const { hap } = thing;
  let values = switchValues;
  if (!values) {
    values = ['1', '2', 'L']; // 1 means SINGLE_PRESS, 2 means DOUBLE_PRESS, L means LONG_PRESS
  }
  multiCharacteristic(thing, service, property, hap.Characteristic.ProgrammableSwitchEvent, undefined, getTopic, values, undefined, true);
  if (restrictSwitchValues) {
    const characteristic = service.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent)!;
    characteristic.props.validValues = restrictSwitchValues;
  }
}

// Characteristic.ServiceLabelIndex (upstream index.js:2382)
export function characteristic_ServiceLabelIndex(thing: ThingContext, service: Service, index: number): void {
  service.setCharacteristic(thing.hap.Characteristic.ServiceLabelIndex, index);
}

// Characteristic.ServiceLabelNamespace (upstream index.js:2387)
export function characteristic_ServiceLabelNamespace(thing: ThingContext, service: Service): void {
  const { config, hap } = thing;
  if (config.labelType === 'dots') {
    service.setCharacteristic(hap.Characteristic.ServiceLabelNamespace, hap.Characteristic.ServiceLabelNamespace.DOTS);
  } else if (config.labelType === 'numerals') {
    service.setCharacteristic(hap.Characteristic.ServiceLabelNamespace, hap.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
  } else {
    service.setCharacteristic(hap.Characteristic.ServiceLabelNamespace, hap.Characteristic.ServiceLabelNamespace.DOTS);
  }
}

// Characteristic.Brightness (upstream index.js:1352-1404)
export function characteristic_Brightness(thing: ThingContext, service: Service): void {
  const { config, state, hap } = thing;

  if (config.topics?.setOn) {
    // separate On topic, so implement standard brightness characteristic
    integerCharacteristic(thing, service, 'brightness', hap.Characteristic.Brightness, config.topics?.setBrightness, config.topics?.getBrightness);
  } else {
    // no separate On topic, so use Brightness 0 to indicate Off state...

    // subscription
    if (config.topics?.getBrightness) {
      thing.subscribe(config.topics.getBrightness, 'brightness', (_topic, message) => {
        const newState = parseInt(String(message));
        const newOn = newState != 0;
        if (state.brightness != newState || state.on != newOn) {
          if (newOn) {
            state.brightness = newState;
            setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.Brightness)!, newState);
          }
          state.on = newOn;
          setCharacteristic(thing, service.getCharacteristic(hap.Characteristic.On)!, newState != 0);
        }
      });
    }

    // publishing (throttled)
    const publishNow = () => {
      let bri = state.brightness;
      if (!config.topics?.setOn && !state.on) {
        bri = 0;
      }
      thing.publish(config.topics?.setBrightness, 'brightness', bri);
    };

    const publish = () => thing.throttledCall(publishNow, 'brightness_pub', 20);

    // Brightness characteristic
    addCharacteristic(thing, service, 'brightness', hap.Characteristic.Brightness, 0, () => {
      if ((state.brightness as number) > 0 && !state.on) {
        state.on = true;
      }
      publish();
    });

    // On Characteristic
    addCharacteristic(thing, service, 'on', hap.Characteristic.On, false, () => {
      if (state.on && state.brightness == 0) {
        state.brightness = 100;
      }
      publish();
    });
  }
}

// doorbell (upstream index.js:3037-3053)
registerServiceType('doorbell', (thing) => {
  const { config, hap } = thing;
  const svcNames = (config.serviceNames || {}) as Record<string, string>;
  const service = new hap.Service.Doorbell(config.name, config.subtype);
  characteristic_ProgrammableSwitchEvent(
    thing,
    service,
    'switch',
    config.topics?.getSwitch,
    config.switchValues as unknown[] | undefined,
    config.restrictSwitchValues as number[] | undefined,
  );
  if (config.topics?.setBrightness || config.topics?.getBrightness) {
    characteristic_Brightness(thing, service);
  }
  if (config.topics?.setVolume || config.topics?.getVolume) {
    characteristic_Volume(thing, service);
  }
  const services = [service];
  if (config.topics?.getMotionDetected) {
    // also create motion sensor
    const motionsvc = new hap.Service.MotionSensor(svcNames.motion || config.name + '-motion', config.subtype);
    characteristic_MotionDetected(thing, motionsvc);
    // return motion sensor too
    services.push(motionsvc);
  }
  return { service, services };
});

// statelessProgrammableSwitch (upstream index.js:3068-3106)
registerServiceType('statelessProgrammableSwitch', (thing) => {
  const { config, hap } = thing;
  // upstream quirk: getSwitch may be a single topic or an array of per-button
  // topics; switchValues/restrictSwitchValues may then be a single array
  // (applied to all buttons) or an array of arrays (per button).
  const getSwitch = config.topics?.getSwitch as TopicSpec | TopicSpec[] | undefined;
  if (Array.isArray(getSwitch)) {
    const service = new hap.Service.ServiceLabel(config.name);
    characteristic_ServiceLabelNamespace(thing, service);
    const services: Service[] = [service];
    const configSwitchValues = config.switchValues as unknown[] | undefined;
    const configRestrictSwitchValues = config.restrictSwitchValues as unknown[] | undefined;
    for (let i = 0; i < getSwitch.length; i++) {
      const buttonTopic = getSwitch[i];
      let switchValues = configSwitchValues;
      if (switchValues) {
        if (Array.isArray(configSwitchValues![0])) {
          if (configSwitchValues!.length > i) {
            switchValues = configSwitchValues![i] as unknown[];
          } else {
            // If array is not long enough, just use the first entry
            switchValues = configSwitchValues![0] as unknown[];
          }
        }
      }
      let restrictSwitchValues = configRestrictSwitchValues;
      if (restrictSwitchValues) {
        if (Array.isArray(configRestrictSwitchValues![0])) {
          if (configRestrictSwitchValues!.length > i) {
            restrictSwitchValues = configRestrictSwitchValues![i] as unknown[];
          } else {
            // If array is not long enough, just use the first entry
            restrictSwitchValues = configRestrictSwitchValues![0] as unknown[];
          }
        }
      }
      // upstream passes the numeric subtype i + 1 (stringified by HAP)
      const buttonSvc = new hap.Service.StatelessProgrammableSwitch(config.name + ' ' + i, String(i + 1));
      characteristic_ProgrammableSwitchEvent(thing, buttonSvc, 'switch' + i, buttonTopic, switchValues, restrictSwitchValues as number[] | undefined);
      characteristic_ServiceLabelIndex(thing, buttonSvc, i + 1);
      services.push(buttonSvc);
    }
    return { service, services };
  } else {
    const service = new hap.Service.StatelessProgrammableSwitch(config.name, config.subtype);
    characteristic_ProgrammableSwitchEvent(
      thing,
      service,
      'switch',
      getSwitch,
      config.switchValues as unknown[] | undefined,
      config.restrictSwitchValues as number[] | undefined,
    );
    return { service };
  }
});
