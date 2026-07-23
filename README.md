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

**No HomeKit re-pairing is needed.** Homebridge identifies a bridged
accessory by the accessory alias plus its configured name
(`uuid.generate("mqttthing:" + name)`), not by the plugin package name.
Since this plugin registers the same `mqttthing` alias and your accessory
names stay the same, every accessory keeps its UUID — room assignments,
automations, and scenes are all preserved. To make the switch seamless:

- Perform steps 1-3 as one operation with a **single restart**. If
  Homebridge runs without the plugin in between, the accessories disappear
  from the bridge and iOS may drop them from automations after syncing.
- Do not rename accessories during the migration (the `name` is part of the
  accessory identity, as it always was).
- If you run mqttthing accessories in a child bridge (`_bridge`), keep the
  same `_bridge.username` and the pairing is preserved too.

## What's new compared to homebridge-mqttthing

- **Custom configuration UI** for the Homebridge UI: searchable accessory
  list built for setups with dozens of accessories, a type-aware editor with
  a topic table, `apply` function editing (the old schema form destroyed
  such configs), full support for the `custom` multi-service type, MQTT
  connection testing, and live topic probing.
- **Outbound publish queue** (`publishMinIntervalms`) with per-topic
  coalescing, protecting low-power devices from HomeKit command bursts.
- **Long-standing upstream bugs fixed**, including spurious color publishes
  at startup, adaptive lighting turning lights on, temperature range
  clamping of sensor readings, wildcard subscriptions, null-payload crashes,
  and history crashes with multiple services — see
  [docs/UpstreamIssues.md](docs/UpstreamIssues.md) for the complete list
  with upstream issue references.

## Documentation

- [Configuration](docs/Configuration.md)
- [Accessory types](docs/Accessories.md)
- [Codecs](docs/Codecs.md)
- [Upstream issues fixed](docs/UpstreamIssues.md)

## Status

This project is under active development. See the release notes for progress.

## License

Apache-2.0. This project is a ground-up rewrite of
[homebridge-mqttthing](https://github.com/arachnetech/homebridge-mqttthing)
by David Miller and contributors — see [NOTICE](NOTICE) for attribution.
