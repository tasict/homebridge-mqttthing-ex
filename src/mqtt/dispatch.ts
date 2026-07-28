// Topic subscriptions of one MQTT connection.
//
// Wildcard filters have to be matched against every incoming topic, but exact
// topics - the overwhelming majority - do not. Keeping the two apart means a
// received message costs one property lookup instead of a scan of every
// subscription, which matters in platform mode where a single connection
// carries the subscriptions of every device sharing its broker.
import type { MessageHandler } from './context.js';
import { topicFilterMatches } from './wiring.js';

export interface TopicDispatch {
  /** Subscribed topic or filter -> handlers, in registration order. */
  handlers: Record<string, MessageHandler[]>;
  /** Just the keys containing '+' or '#', so the common case skips them. */
  wildcards: string[];
}

export function makeTopicDispatch(): TopicDispatch {
  return { handlers: {}, wildcards: [] };
}

/**
 * Registers a handler. Returns true when this is the first handler for the
 * topic, which is when the caller has to subscribe to it.
 */
export function addHandler(dispatch: TopicDispatch, topic: string, handler: MessageHandler): boolean {
  const existing = dispatch.handlers[topic];
  if (existing) {
    existing.push(handler);
    return false;
  }
  dispatch.handlers[topic] = [handler];
  if (topic.includes('+') || topic.includes('#')) {
    dispatch.wildcards.push(topic);
  }
  return true;
}

/**
 * Handlers for a received topic: those registered for it exactly, plus those
 * of every wildcard filter it matches (issue #500 - upstream never dispatched
 * wildcard subscriptions at all).
 */
export function handlersFor(dispatch: TopicDispatch, topic: string): MessageHandler[] {
  const exact = dispatch.handlers[topic];
  if (dispatch.wildcards.length === 0) {
    return exact ?? [];
  }
  const handlers = exact ? [...exact] : [];
  for (const filter of dispatch.wildcards) {
    if (filter !== topic && topicFilterMatches(filter, topic)) {
      handlers.push(...dispatch.handlers[filter]);
    }
  }
  return handlers;
}
