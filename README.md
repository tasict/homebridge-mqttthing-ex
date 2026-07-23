# homebridge-mqttthing-ex

A [Homebridge](https://homebridge.io) plugin supporting a wide range of HomeKit
services over MQTT — a modern, actively maintained successor to
[homebridge-mqttthing](https://github.com/arachnetech/homebridge-mqttthing).

## Highlights

- **Drop-in replacement** — your existing `config.json` works unchanged.
  Accessory entries keep using `"accessory": "mqttthing"`.
- **Homebridge v2 ready** — TypeScript, ES modules, modern HAP APIs
  (`onGet`/`onSet`), works on Homebridge 1.8+ and 2.x.
- **Device protection** — optional outbound publish queue with throttling and
  message coalescing, so HomeKit scene bursts and slider drags cannot overwhelm
  low-power IoT devices.
- **Full codec & apply compatibility** — existing CommonJS codec files and
  `{ "topic": ..., "apply": ... }` expressions keep working as before.

## Migration from homebridge-mqttthing

1. Uninstall `homebridge-mqttthing` (both plugins register the accessory name
   `mqttthing`, so they cannot be installed at the same time).
2. Install `homebridge-mqttthing-ex`.
3. Restart Homebridge. **No configuration changes are required.**

## Documentation

- [Configuration](docs/Configuration.md)
- [Accessory types](docs/Accessories.md)
- [Codecs](docs/Codecs.md)

## Status

This project is under active development. See the release notes for progress.

## License

Apache-2.0. This project is a ground-up rewrite of
[homebridge-mqttthing](https://github.com/arachnetech/homebridge-mqttthing)
by David Miller and contributors — see [NOTICE](NOTICE) for attribution.
