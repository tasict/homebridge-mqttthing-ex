// Custom UI server: spawned as a child process by homebridge-config-ui-x
// while the plugin settings screen is open. A thin shell around the pure
// handlers in server-lib.mjs (which carry the unit tests).
import { readdir } from 'node:fs/promises';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import mqtt from 'mqtt';

import { listCodecs, probeTopic, testMqttConnection } from './server-lib.mjs';

const MQTT_TEST_TIMEOUT_MS = 5000;
const MQTT_PROBE_DURATION_MS = 5000;

class MqttThingUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    // List available codecs: bundled names + *.js files in the Homebridge
    // storage path (the only directory this server ever reads).
    this.onRequest('/codecs', () => listCodecs(readdir, this.homebridgeStoragePath));

    // Try to connect to a broker with the given url/username/password.
    this.onRequest('/mqtt/test', async (payload) => {
      const result = await testMqttConnection(mqtt.connect, payload ?? {}, MQTT_TEST_TIMEOUT_MS);
      if (!result.ok) {
        throw new RequestError(result.message);
      }
      return result;
    });

    // Subscribe to one topic for a few seconds, pushing each received
    // message to the UI as an 'mqtt-probe' event.
    this.onRequest('/mqtt/probe', async (payload) => {
      const id = typeof payload?.id === 'string' ? payload.id : null;
      const result = await probeTopic(
        mqtt.connect,
        payload ?? {},
        (topic, message) => this.pushEvent('mqtt-probe', { id, topic, payload: message }),
        MQTT_PROBE_DURATION_MS,
      );
      if (!result.ok) {
        throw new RequestError(result.message);
      }
      return result;
    });

    this.ready();
  }
}

(() => new MqttThingUiServer())();
