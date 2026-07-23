// Minimal logging interface satisfied by Homebridge's Logging object.
// Kept structural so tests can supply a plain function with warn/error attached.
export interface Log {
  (message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function makeConsoleLog(prefix = ''): Log {
  const base = (message: string) => console.log(prefix + message);
  const log = base as Log;
  log.warn = (message: string) => console.warn(prefix + message);
  log.error = (message: string) => console.error(prefix + message);
  return log;
}
