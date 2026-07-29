// MQTT connection setup, ported from upstream libs/mqttlib.js init().
//
// The pieces below are split so that platform mode can reuse them: one
// connection can be opened for a group of devices (createDispatchingClient
// over a shared dispatch map) while each device still prepares its own
// codec/queue state (initDeviceContext). Accessory mode recomposes them in
// init(), which behaves exactly as before.
import fs from 'node:fs';

import mqtt from 'mqtt';

import { loadCodec } from '../codec/loader.js';
import { brokerEnv } from '../env.js';
import type { Log } from '../log.js';
import type { BrokerSettings } from '../model/broker-key.js';
import type { MqttContext } from './context.js';
import { handlersFor, makeTopicDispatch, type TopicDispatch } from './dispatch.js';
import { PublishQueue } from './queue.js';
import { optimizedPublish, rawSend } from './wiring.js';

/** Last-will message used unless the user configured their own. */
export interface WillSpec {
  topic: string;
  payload: string;
  qos: 0;
  retain: false;
}

export interface AssembledBroker {
  url: string;
  options: Record<string, unknown>;
}

/** Client id in upstream's format: mqttthing_<base>_<8 hex digits>. */
export function makeClientId(base: string): string {
  return 'mqttthing_' + base.replace(/[^\x20-\x7F]/g, '') + '_' + Math.random().toString(16).slice(2, 10);
}

/**
 * Per-device context preparation: publish-value cache, outbound queue and
 * codec. Never touches mqttDispatch/propDispatch/mqttClient, so it is safe to
 * call for a device joining an already-established shared connection.
 */
export function initDeviceContext(ctx: MqttContext): void {
  const { config, log } = ctx;

  // create cache of last-published values for publishing optimization
  if (config.optimizePublishing) {
    ctx.lastPubValues = {};
  }

  // outbound publish queue (mqttthing-ex device protection; opt-in)
  if (config.publishMinIntervalms) {
    ctx.publishQueue = new PublishQueue(
      (topic, message) => rawSend(ctx, topic, message),
      config.publishMinIntervalms,
      config.publishQueueLimit ?? 1000,
      config.publishCoalesce !== false,
      log,
    );
  }

  // Load any codec
  if (config.codec) {
    // direct publishing
    const directPub = (topic: string, message: unknown) => {
      optimizedPublish(topic, message, ctx);
    };

    // notification by property
    const notifyByProp = (property: string, message: unknown) => {
      const handlers = ctx.propDispatch[property];
      if (handlers) {
        for (let i = 0; i < handlers.length; i++) {
          handlers[i]('_prop-' + property, message);
        }
      }
    };

    ctx.codec = loadCodec(config.codec, ctx.homebridgePath, {
      log,
      config,
      publish: directPub,
      notify: notifyByProp,
    });
  }
}

/**
 * Builds the broker URL and mqtt.connect options. Standard options are only
 * filled in where the user has not set them, so a configured clientId or will
 * always wins.
 *
 * Note the options object is `source.mqttOptions` itself when present - that
 * in-place enrichment is long-standing accessory-mode behavior. Callers that
 * must not modify the user's config (platform mode, where one options object
 * would serve several devices) pass a copy.
 */
export function assembleBrokerOptions(
  source: BrokerSettings,
  clientId: string,
  defaultWill: WillSpec,
): AssembledBroker {
  // start with any configured options object
  const options: Record<string, unknown> = source.mqttOptions || {};

  // MQTTTHING_* fallbacks (see env.ts)
  const env = brokerEnv();

  // standard options set by mqtt-thing
  const myOptions: Record<string, unknown> = {
    keepalive: 10,
    clientId: clientId,
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
    will: defaultWill,
    username: source.username || env.MQTTTHING_USERNAME,
    password: source.password || env.MQTTTHING_PASSWORD,
    rejectUnauthorized: false,
  };

  // copy standard options into options unless already set by user
  for (const opt in myOptions) {
    if (
      Object.prototype.hasOwnProperty.call(myOptions, opt) &&
      !Object.prototype.hasOwnProperty.call(options, opt)
    ) {
      options[opt] = myOptions[opt];
    }
  }

  // load ca/cert/key files
  if (options.cafile) {
    options.ca = fs.readFileSync(options.cafile as string);
  }
  if (options.certfile) {
    options.cert = fs.readFileSync(options.certfile as string);
  }
  if (options.keyfile) {
    options.key = fs.readFileSync(options.keyfile as string);
  }

  // insecure
  if (options.insecure) {
    options.checkServerIdentity = () => {
      return undefined; /* servername and certificate are verified */
    };
  }

  // add protocol to url string, if not yet available; default to a local
  // broker instead of passing an empty string to mqtt.connect (issue #606)
  let brokerUrl = source.url || env.MQTTTHING_URL || 'mqtt://localhost:1883';
  if (brokerUrl && !brokerUrl.includes('://')) {
    brokerUrl = 'mqtt://' + brokerUrl;
  }

  return { url: brokerUrl, options };
}

/**
 * Connects to the broker and routes incoming messages through the given
 * dispatch map. The map is held by reference: in platform mode all devices
 * sharing a connection share one map, so a topic is subscribed once and every
 * registered handler still receives it.
 */
export function createDispatchingClient(
  url: string,
  options: Record<string, unknown>,
  log: Log,
  logMqtt: boolean,
  dispatch: TopicDispatch,
): mqtt.MqttClient {
  // log MQTT settings
  if (logMqtt) {
    log('MQTT URL: ' + url);
    log(
      'MQTT options: ' +
        JSON.stringify(options, (k, v) => {
          if (k === 'password') {
            return undefined; // filter out
          }
          return v;
        }),
    );
  }

  // create MQTT client
  const mqttClient = mqtt.connect(url, options as mqtt.IClientOptions);
  mqttClient.on('error', (err) => {
    log('MQTT Error: ' + err);
    // unwrap AggregateError (e.g. IPv6+IPv4 connection refusal on modern
    // Node, issue #670) so the real cause is visible
    const errors = (err as { errors?: unknown[] }).errors;
    if (Array.isArray(errors)) {
      for (const cause of errors) {
        log('MQTT Error cause: ' + cause);
      }
    }
  });

  mqttClient.on('message', (topic, message) => {
    if (logMqtt) {
      log('Received MQTT: ' + topic + ' = ' + message);
    }
    const handlers = handlersFor(dispatch, topic);
    if (handlers.length > 0) {
      for (let i = 0; i < handlers.length; i++) {
        handlers[i](topic, message);
      }
    } else {
      log('Warning: No MQTT dispatch handler for topic [' + topic + ']');
    }
  });

  return mqttClient;
}

/**
 * Initialise MQTT for an accessory context. Populates ctx.mqttClient,
 * ctx.mqttDispatch, ctx.propDispatch, ctx.codec, and (when enabled)
 * ctx.lastPubValues / ctx.publishQueue.
 */
export function init(ctx: MqttContext): mqtt.MqttClient {
  // MQTT message dispatch
  const mqttDispatch = (ctx.mqttDispatch = makeTopicDispatch());
  ctx.propDispatch = {};

  const { config, log } = ctx;

  initDeviceContext(ctx);

  const clientId = makeClientId(config.name);
  const { url, options } = assembleBrokerOptions(
    {
      url: config.url,
      username: config.username,
      password: config.password,
      mqttOptions: config.mqttOptions,
    },
    clientId,
    {
      topic: 'WillMsg',
      payload: 'mqtt-thing [' + config.name + '] has stopped',
      qos: 0,
      retain: false,
    },
  );

  const mqttClient = createDispatchingClient(url, options, log, !!config.logMqtt, mqttDispatch);

  ctx.mqttClient = mqttClient;
  return mqttClient;
}
