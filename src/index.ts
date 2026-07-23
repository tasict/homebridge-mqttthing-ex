import type { API } from 'homebridge';

import { MqttThingAccessory } from './accessory.js';
import { ACCESSORY_NAME, PLUGIN_NAME } from './settings.js';

export default (api: API): void => {
  api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, MqttThingAccessory);
};
