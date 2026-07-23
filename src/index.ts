import type { API } from 'homebridge';

import { MqttThingAccessory } from './accessory.js';
import { ACCESSORY_NAME, PLUGIN_NAME } from './settings.js';

export default (api: API): void => {
  try {
    api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, MqttThingAccessory);
  } catch (ex) {
    // The "mqttthing" accessory name is kept for config compatibility, so
    // this plugin cannot be installed alongside the original
    // homebridge-mqttthing. Fail with clear guidance instead of a stack
    // trace; the original plugin keeps serving the accessories until it is
    // removed.
    console.error(
      `[${PLUGIN_NAME}] Could not register the "${ACCESSORY_NAME}" accessory - ` +
        'another plugin (usually the original homebridge-mqttthing) has already registered it. ' +
        `Uninstall homebridge-mqttthing and restart Homebridge to activate ${PLUGIN_NAME}. ` +
        'Your configuration does not need any changes. ' +
        `(${ex})`,
    );
  }
};
