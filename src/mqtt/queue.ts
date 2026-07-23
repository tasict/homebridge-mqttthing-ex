import type { Log } from '../log.js';

interface QueueEntry {
  topic: string;
  message: string;
}

/**
 * Outbound publish queue (new in mqttthing-ex).
 *
 * Protects low-power IoT devices from bursts of HomeKit-driven writes (scene
 * activations, slider drags) by pacing MQTT publishes:
 * - a minimum interval is enforced between publishes;
 * - queued messages for the same topic are coalesced (latest wins) unless
 *   disabled, so a slider drag delivers only the final value;
 * - the queue is bounded; on overflow the oldest entry is dropped with a
 *   warning.
 *
 * The queue is only created when `publishMinIntervalms` is configured;
 * without it, publishing is fully synchronous and upstream-identical. When
 * the queue is idle and the interval has elapsed, the first publish is sent
 * synchronously so single writes keep upstream latency.
 */
export class PublishQueue {
  private readonly queue: QueueEntry[] = [];
  private readonly byTopic = new Map<string, QueueEntry>();
  private timer: NodeJS.Timeout | null = null;
  private lastSendTime = -Infinity;

  constructor(
    private readonly send: (topic: string, message: string) => void,
    private readonly minIntervalms: number,
    private readonly limit: number,
    private readonly coalesce: boolean,
    private readonly log: Log,
  ) {}

  enqueue(topic: string, message: string): void {
    if (this.coalesce) {
      const pending = this.byTopic.get(topic);
      if (pending) {
        // latest wins; queue position is kept
        pending.message = message;
        return;
      }
    }

    if (this.queue.length >= this.limit) {
      const dropped = this.queue.shift();
      if (dropped) {
        this.byTopic.delete(dropped.topic);
        this.log.warn(
          'Publish queue full (' + this.limit + ') - dropping oldest message for topic [' + dropped.topic + ']',
        );
      }
    }

    const entry: QueueEntry = { topic, message };
    this.queue.push(entry);
    if (this.coalesce) {
      this.byTopic.set(topic, entry);
    }

    if (!this.timer) {
      const wait = this.lastSendTime + this.minIntervalms - Date.now();
      if (wait <= 0) {
        this.sendNext();
      } else {
        this.scheduleSend(wait);
      }
    }
  }

  /** Number of messages waiting to be sent. */
  get pending(): number {
    return this.queue.length;
  }

  private scheduleSend(wait: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sendNext();
    }, wait);
  }

  private sendNext(): void {
    const entry = this.queue.shift();
    if (!entry) {
      return;
    }
    this.byTopic.delete(entry.topic);
    this.lastSendTime = Date.now();
    this.send(entry.topic, entry.message);
    if (this.queue.length > 0 && !this.timer) {
      this.scheduleSend(this.minIntervalms);
    }
  }
}
