// Confirmed publisher, ported from upstream libs/mqttlib.js:380-454.
import type { TopicSpec } from '../config.js';
import type { MqttContext } from './context.js';
import { publish, subscribe } from './wiring.js';

export type Publisher = (message: unknown) => void;

/**
 * Returns a publishing function. When confirmation is enabled
 * (config.confirmationPeriodms set, a get topic present, and makeConfirmed
 * true), the returned function publishes and then expects the value to echo
 * back on the get topic within the confirmation period, retrying up to
 * config.retryLimit times (default 3) and marking the accessory offline
 * according to config.confirmationIndicateOffline.
 *
 * Note: `state` is captured from the context at creation time — for "custom"
 * multi-service accessories each sub-service has its own state object, and
 * the confirmation publisher must keep pointing at the one current when it
 * was created (upstream behavior).
 */
export function makeConfirmedPublisher(
  ctx: MqttContext,
  setTopic: TopicSpec | undefined,
  getTopic: TopicSpec | undefined,
  property: string,
  makeConfirmed?: boolean,
): Publisher {
  const { state, config, log } = ctx;

  // if confirmation isn't being used, just return a simple publishing function
  if (!config.confirmationPeriodms || !getTopic || !makeConfirmed) {
    // no confirmation - return generic publishing function
    return (message) => {
      publish(ctx, setTopic, property, message);
    };
  }

  let timer: NodeJS.Timeout | null = null;
  let expected: unknown = null;
  let indicatedOffline = false;
  let retriesRemaining = 0;

  // subscribe to our get topic
  subscribe(ctx, getTopic, property, (_topic, message) => {
    if ((message === expected || message == expected + '') && timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (indicatedOffline && !timer) {
      // if we're not waiting (or no-longer waiting), a message clears the offline state
      state.online = true;
      indicatedOffline = false;
      log('Setting accessory state to online');
    }
  });

  // return enhanced publishing function
  return (message) => {
    // clear any existing confirmation timer
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    // confirmation timeout function
    const confirmationTimeout = () => {
      // confirmation period has expired
      timer = null;
      // indicate offline (unless accessory is publishing this explicitly - overridden with confirmationIndicateOffline)
      if (
        config.confirmationIndicateOffline !== false &&
        (!config.topics?.getOnline || config.confirmationIndicateOffline === true) &&
        !indicatedOffline
      ) {
        state.online = false;
        indicatedOffline = true;
        log('Setting accessory state to offline');
      }

      // retry
      if (retriesRemaining > 0) {
        --retriesRemaining;
        doPublish();
      } else {
        log('Unresponsive - no confirmation message received on ' + getTopic + '. Expecting [' + expected + '].');
      }
    };

    const doPublish = () => {
      // set confirmation timer
      timer = setTimeout(confirmationTimeout, config.confirmationPeriodms);

      // publish
      expected = message;
      publish(ctx, setTopic, property, message);
    };

    // initialise retry counter
    retriesRemaining = config.retryLimit === undefined ? 3 : config.retryLimit;

    // initial publish
    doPublish();
  };
}
