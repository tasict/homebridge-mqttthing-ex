// Shared MQTT connections for platform mode.
//
// Accessory mode opens one connection per accessory. In platform mode the
// devices of a platform block usually talk to the same broker with the same
// credentials, so they are grouped by their effective broker settings
// (src/model/broker-key.ts, shared with the settings UI) and each group gets
// a single connection.
import type { MqttClient } from 'mqtt';

import type { Log } from '../log.js';
import type { EffectiveBroker } from '../model/broker-key.js';
import { assembleBrokerOptions, createDispatchingClient, makeClientId } from './client.js';
import { makeTopicDispatch, type TopicDispatch } from './dispatch.js';

export interface MqttConnection {
  client: MqttClient;
  /** Topic subscriptions, shared by every device on this connection. */
  dispatch: TopicDispatch;
}

export interface OpenConnectionOptions {
  /** Names the client to the broker and the connection's last will. */
  name: string;
  log: Log;
  /** True when any device on this connection has logMqtt enabled. */
  logMqtt: boolean;
}

/**
 * Opens one connection for a group of devices. The dispatch map is created
 * here and handed to every member device's context by reference, so a topic
 * several devices listen to is subscribed once and dispatched to all of them.
 */
export function openConnection(effective: EffectiveBroker, opts: OpenConnectionOptions): MqttConnection {
  const dispatch = makeTopicDispatch();

  // A copy of mqttOptions: unlike accessory mode (one options object per
  // accessory) this object would be shared, and enriching the user's config
  // object with derived defaults and TLS buffers is not wanted here.
  const { url, options } = assembleBrokerOptions(
    {
      url: effective.url,
      username: effective.username,
      password: effective.password,
      mqttOptions: { ...effective.mqttOptions },
    },
    makeClientId(opts.name),
    {
      topic: 'WillMsg',
      payload: 'mqtt-thing [' + opts.name + '] has stopped',
      qos: 0,
      retain: false,
    },
  );

  return { client: createDispatchingClient(url, options, opts.log, opts.logMqtt, dispatch), dispatch };
}
