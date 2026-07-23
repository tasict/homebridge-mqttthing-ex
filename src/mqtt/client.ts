// MQTT connection setup, ported from upstream libs/mqttlib.js init().
import fs from 'node:fs';

import mqtt from 'mqtt';

import { loadCodec } from '../codec/loader.js';
import type { MqttContext } from './context.js';
import { PublishQueue } from './queue.js';
import { optimizedPublish, rawSend, topicFilterMatches } from './wiring.js';

/**
 * Initialise MQTT for an accessory context. Populates ctx.mqttClient,
 * ctx.mqttDispatch, ctx.propDispatch, ctx.codec, and (when enabled)
 * ctx.lastPubValues / ctx.publishQueue.
 */
export function init(ctx: MqttContext): mqtt.MqttClient {
  // MQTT message dispatch
  const mqttDispatch = (ctx.mqttDispatch = {} as MqttContext['mqttDispatch']);
  ctx.propDispatch = {};

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

  const logmqtt = config.logMqtt;
  const clientId =
    'mqttthing_' + config.name.replace(/[^\x20-\x7F]/g, '') + '_' + Math.random().toString(16).slice(2, 10);

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

  // start with any configured options object
  const options: Record<string, unknown> = (config.mqttOptions as Record<string, unknown>) || {};

  // standard options set by mqtt-thing
  const myOptions: Record<string, unknown> = {
    keepalive: 10,
    clientId: clientId,
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
    will: {
      topic: 'WillMsg',
      payload: 'mqtt-thing [' + config.name + '] has stopped',
      qos: 0,
      retain: false,
    },
    username: config.username || process.env.MQTTTHING_USERNAME,
    password: config.password || process.env.MQTTTHING_PASSWORD,
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
  let brokerUrl = config.url || process.env.MQTTTHING_URL || 'mqtt://localhost:1883';
  if (brokerUrl && !brokerUrl.includes('://')) {
    brokerUrl = 'mqtt://' + brokerUrl;
  }

  // log MQTT settings
  if (logmqtt) {
    log('MQTT URL: ' + brokerUrl);
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
  const mqttClient = mqtt.connect(brokerUrl as string, options as mqtt.IClientOptions);
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
    if (logmqtt) {
      log('Received MQTT: ' + topic + ' = ' + message);
    }
    // exact-topic handlers, plus wildcard subscriptions matched per the MQTT
    // spec (issue #500: wildcard subscriptions never dispatched upstream)
    const handlers = [...(mqttDispatch[topic] ?? [])];
    for (const filter of Object.keys(mqttDispatch)) {
      if (filter !== topic && (filter.includes('+') || filter.includes('#')) && topicFilterMatches(filter, topic)) {
        handlers.push(...mqttDispatch[filter]);
      }
    }
    if (handlers.length > 0) {
      for (let i = 0; i < handlers.length; i++) {
        handlers[i](topic, message);
      }
    } else {
      log('Warning: No MQTT dispatch handler for topic [' + topic + ']');
    }
  });

  ctx.mqttClient = mqttClient;
  return mqttClient;
}
