// television accessory type.
// Ported from upstream index.js dispatch branch (3365-3421).
import { Buffer } from 'node:buffer';

import type { Service } from 'homebridge';

import {
  addCharacteristic,
  multiCharacteristic,
  type CharacteristicSelector,
  type ThingContext,
} from '../hap/binding.js';
import { characteristic_Active } from './controls.js';
import { registerServiceType } from './registry.js';

// Characteristic.ActiveIdentifier (upstream index.js:2752)
function characteristic_ActiveIdentifier(thing: ThingContext, service: Service, values: unknown[]): void {
  const { config, hap } = thing;
  multiCharacteristic(
    thing,
    service,
    'activeIdentifier',
    hap.Characteristic.ActiveIdentifier,
    config.topics?.setActiveInput,
    config.topics?.getActiveInput,
    values,
    0,
  );
}

// (upstream index.js:2766)
function characteristic_Remote(thing: ThingContext, service: Service, characteristic: CharacteristicSelector): void {
  const { config } = thing;
  let values = config.remoteKeyValues as unknown[] | undefined;
  if (!values) {
    values = ['VOLUME_UP', 'VOLUME_DOWN', 'NEXT_TRACK', 'PREVIOUS_TRACK', 'UP', 'DOWN', 'LEFT', 'RIGHT',
      'SELECT', 'BACK', 'EXIT', 'PLAY_PAUSE', '12', '13', '14', 'INFO'];
  }
  multiCharacteristic(thing, service, 'remoteKey', characteristic, config.topics?.setRemoteKey, undefined, values, undefined, true);
}

// Characteristic.VolumeSelector (upstream index.js:2757)
function characteristic_RemoteKeyVolume(thing: ThingContext, service: Service): void {
  characteristic_Remote(thing, service, thing.hap.Characteristic.VolumeSelector);
}

// Characteristic.RemoteKey (upstream index.js:2762)
function characteristic_RemoteKey(thing: ThingContext, service: Service): void {
  characteristic_Remote(thing, service, thing.hap.Characteristic.RemoteKey);
}

// television (upstream index.js:3365-3421)
registerServiceType('television', (thing) => {
  const { config, hap, state } = thing;
  const { Characteristic } = hap;
  const name = config.name;
  const service = new hap.Service.Television(name, config.subtype);
  service.isPrimaryService = true;
  characteristic_Active(thing, service);
  service.setCharacteristic(Characteristic.ActiveIdentifier, 0);
  service.setCharacteristic(Characteristic.ConfiguredName, name);
  service.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

  const speakerService = new hap.Service.TelevisionSpeaker(
    'Volume',
    'volumeService',
  );
  speakerService
    .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
    .setCharacteristic(
      Characteristic.VolumeControlType,
      Characteristic.VolumeControlType.ABSOLUTE,
    );

  characteristic_RemoteKey(thing, service);
  characteristic_RemoteKeyVolume(thing, speakerService);

  const services = [service, speakerService];

  if (config.inputs) {
    const inputs = config.inputs as Array<{ name?: string; value?: unknown }>;
    const inputValues: unknown[] = ['NONE']; // MQTT values for ActiveIdentifier
    const displayOrderTlvArray: number[] = []; // for specific order instead of default alphabetical ordering
    inputs.forEach((input, index) => {
      const inputId = index + 1;
      const inputName = input.name || 'Input ' + inputId;
      const inputSvc = new hap.Service.InputSource(inputName, String(inputId));
      inputSvc.isHiddenService = true; // not sure if necessary
      service.addLinkedService(inputSvc); // inputSvc must be linked to main service
      inputSvc.setCharacteristic(Characteristic.Identifier, inputId);
      inputSvc.setCharacteristic(Characteristic.ConfiguredName, inputName);
      inputSvc.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED); // necessary for input to appear
      inputSvc.setCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.OTHER); // no impact?
      inputSvc.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER); // no impact?
      const visibilityStateProperty = 'input' + inputId + '-visible';
      addCharacteristic(thing, inputSvc, visibilityStateProperty, Characteristic.TargetVisibilityState, Characteristic.TargetVisibilityState.SHOWN, function () {
        // change CurrentVisibilityState when TargetVisibilityState changes
        inputSvc.setCharacteristic(Characteristic.CurrentVisibilityState, state[visibilityStateProperty] as number);
      });
      inputValues.push(input.value || inputId);
      displayOrderTlvArray.push(1, 1, inputId); // type = 1 ("Identifier"), length = 1 Byte, Identifier value
      services.push(inputSvc);
    });
    characteristic_ActiveIdentifier(thing, service, inputValues); // for selecting inputs
    const displayOrderTlv = Buffer.from(displayOrderTlvArray).toString('base64');
    service.setCharacteristic(Characteristic.DisplayOrder, displayOrderTlv);
  }
  return { service, services };
});
