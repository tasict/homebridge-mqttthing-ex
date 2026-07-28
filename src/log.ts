// Minimal logging interface satisfied by Homebridge's Logging object.
// Kept structural so tests can supply a plain function with warn/error attached.
export interface Log {
  (message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Wraps a log with a fixed prefix. Platform mode shares one Homebridge logger
 * between all devices, so each device gets its own prefixed view to keep
 * messages attributable. `debug` is forwarded only when the base log has it
 * (fakegato probes it optionally).
 */
export function makePrefixedLog(base: Log, prefix: string): Log {
  const log = ((message: string) => base(prefix + message)) as Log;
  log.warn = (message: string) => base.warn(prefix + message);
  log.error = (message: string) => base.error(prefix + message);
  const debug = (base as { debug?: (message: string) => void }).debug;
  if (debug) {
    (log as { debug?: (message: string) => void }).debug = (message: string) =>
      debug.call(base, prefix + message);
  }
  return log;
}

export function makeConsoleLog(prefix = ''): Log {
  const base = (message: string) => console.log(prefix + message);
  const log = base as Log;
  log.warn = (message: string) => console.warn(prefix + message);
  log.error = (message: string) => console.error(prefix + message);
  return log;
}
