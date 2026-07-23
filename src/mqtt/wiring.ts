// Subscribe/publish pipelines, ported from upstream libs/mqttlib.js.
//
// Pipeline order is compatibility-critical:
//   receive: debounce (outermost) -> apply decode -> codec decode -> jsonpath
//   publish: apply encode -> codec encode -> optimizedPublish
import jsonpath from 'jsonpath';

import { getCodecFunction } from '../codec/loader.js';
import type { TopicSpec, ExtendedTopic } from '../config.js';
import { getApplyState, type MessageHandler, type MqttContext } from './context.js';

/** Actually hand a message to the MQTT client (or log it). */
export function rawSend(ctx: MqttContext, topic: string, messageString: string): void {
  const { config, log, mqttClient } = ctx;
  if (config.logMqtt) {
    log('Publishing MQTT: ' + topic + ' = ' + messageString);
  }
  mqttClient?.publish(topic, messageString, (config.mqttPubOptions ?? {}) as never);
}

/**
 * Final publishing step (upstream mqttlib.js:28-43): optimizePublishing
 * dedupe, then either the outbound publish queue (when configured) or a
 * direct client publish.
 */
export function optimizedPublish(topic: string, message: unknown, ctx: MqttContext): void {
  const { config } = ctx;
  const messageString = String(message);
  if (config.optimizePublishing && ctx.lastPubValues) {
    if (ctx.lastPubValues[topic] === messageString) {
      // optimized - don't publish
      return;
    }
    // store what we're about to publish
    ctx.lastPubValues[topic] = messageString;
  }
  if (ctx.publishQueue) {
    ctx.publishQueue.enqueue(topic, messageString);
  } else {
    rawSend(ctx, topic, messageString);
  }
}

/** Subscribe a property handler to a topic (upstream mqttlib.js:221-327). */
export function subscribe(ctx: MqttContext, topicSpec: TopicSpec, property: string, handler: MessageHandler): void {
  const rawHandler = handler;
  const { mqttDispatch, log, mqttClient, codec, propDispatch, config } = ctx;
  if (!mqttClient) {
    log('ERROR: Call mqtt init() before subscribe()');
    return;
  }

  // debounce
  if (config.debounceRecvms) {
    const origHandler = handler;
    let debounceTimeout: NodeJS.Timeout | null = null;
    handler = (intopic, message) => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      debounceTimeout = setTimeout(() => {
        origHandler(intopic, message);
      }, config.debounceRecvms);
    };
  }

  let extendedTopic: ExtendedTopic | null = null;
  let topic: string;
  // send through any apply function
  if (typeof topicSpec !== 'string') {
    extendedTopic = topicSpec;
    topic = extendedTopic.topic;
    if (Object.prototype.hasOwnProperty.call(extendedTopic, 'apply')) {
      const previous = handler;
      const applyFn = Function('message', 'state', extendedTopic.apply as string);
      handler = (intopic, message) => {
        let decoded: unknown;
        try {
          decoded = applyFn(message, getApplyState(ctx, property));
          if (config.logMqtt) {
            log('apply() function decoded message to [' + decoded + ']');
          }
        } catch (ex) {
          log(
            'Decode function apply( message) { ' + extendedTopic!.apply + ' } failed for topic ' + topic +
              ' with message ' + message + ' - ' + ex,
          );
        }
        if (decoded !== undefined) {
          return previous(intopic, decoded);
        }
      };
    }
  } else {
    topic = topicSpec;
  }

  // send through codec's decode function
  const codecDecode = getCodecFunction(codec, property, 'decode');
  if (codecDecode) {
    const realHandler = handler;
    const output = (message: unknown) => {
      return realHandler(topic, message);
    };
    handler = (_intopic, message) => {
      const decoded = codecDecode(message, { topic, property, extendedTopic }, output);
      if (config.logMqtt) {
        log('codec decoded message to [' + decoded + ']');
      }
      if (decoded !== undefined) {
        return output(decoded);
      }
    };
  }

  // register property dispatch (codec only)
  if (codec) {
    if (Object.prototype.hasOwnProperty.call(propDispatch, property)) {
      // new handler for existing property
      propDispatch[property].push(rawHandler);
    } else {
      // new property
      propDispatch[property] = [rawHandler];
      if (config.logMqtt) {
        log('Avalable codec notification property: ' + property);
      }
    }
  }

  // JSONPath
  const jsonpathIndex = topic?.indexOf('$') ?? -1;
  if (jsonpathIndex > 0) {
    const jsonpathQuery = topic.substring(jsonpathIndex);
    topic = topic.substring(0, jsonpathIndex);

    const lastHandler = handler;
    handler = (_intopic, message) => {
      const json = JSON.parse(String(message));
      const values = jsonpath.query(json, jsonpathQuery);
      const output = values.shift();
      if (config.logMqtt) {
        log(`jsonpath ${jsonpathQuery} decoded message to [${output}]`);
      }
      return lastHandler(topic, output);
    };
  }

  // register MQTT dispatch and subscribe
  if (Object.prototype.hasOwnProperty.call(mqttDispatch, topic)) {
    // new handler for existing topic
    mqttDispatch[topic].push(handler);
  } else {
    // new topic
    mqttDispatch[topic] = [handler];
    mqttClient.subscribe(topic);
  }
}

/** Publish a property value to a topic (upstream mqttlib.js:330-377). */
export function publish(ctx: MqttContext, topicSpec: TopicSpec | undefined, property: string, message: unknown): void {
  const { log, mqttClient, codec } = ctx;
  if (!mqttClient) {
    log('ERROR: Call mqtt init() before publish()');
    return;
  }

  if (message === null || topicSpec === undefined) {
    return; // don't publish if message is null or topic is undefined
  }

  let extendedTopic: ExtendedTopic | null = null;
  let topic: string;
  // first of all, pass message through any user-supplied apply() function
  if (typeof topicSpec !== 'string') {
    // encode data with user-supplied apply() function
    extendedTopic = topicSpec;
    topic = extendedTopic.topic;
    if (Object.prototype.hasOwnProperty.call(extendedTopic, 'apply')) {
      const applyFn = Function('message', 'state', extendedTopic.apply as string);
      try {
        message = applyFn(message, getApplyState(ctx, property));
      } catch (ex) {
        log(
          'Encode function apply( message ) { ' + extendedTopic.apply + ' } failed for topic ' + topic +
            ' with message ' + message + ' - ' + ex,
        );
        message = null; // stop publish
      }
      if (message === null || message === undefined) {
        return;
      }
    }
  } else {
    topic = topicSpec;
  }

  const publishImpl = (finalMessage: unknown) => {
    optimizedPublish(topic, finalMessage, ctx);
  };

  // publish directly or through codec
  const codecEncode = getCodecFunction(codec, property, 'encode');
  if (codecEncode) {
    // send through codec's encode function
    const encoded = codecEncode(message, { topic, property, extendedTopic }, publishImpl);
    if (encoded !== undefined) {
      publishImpl(encoded);
    }
  } else {
    // publish as-is
    publishImpl(message);
  }
}
