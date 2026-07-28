# Changelog

## 1.1.0

### Added

- **Platform mode** — an optional second configuration format: one
  `"platform": "mqttthing-ex"` block containing a `devices` array, taking
  exactly the same per-device settings as an accessory block. Accessory
  entries keep `"accessory": "mqttthing"` and behave exactly as before.
- **One MQTT connection per broker instead of one per device.** Devices whose
  effective broker settings match share a connection; a device overriding
  `url`, `username`, `password` or `mqttOptions` gets its own. Broker settings
  on the platform block act as defaults for every device.
- **A stable device identity.** The new optional per-device `id` decides the
  HomeKit accessory, so a device can be renamed without HomeKit treating it as
  a new one. An `id` that is a UUID *is* that accessory; any other value is
  used the way a name is.
- **Moving accessories into platform mode from the settings UI**, per device
  or all at once, with a preview of which ones can be moved and how many MQTT
  connections it saves. Each device's `id` is set to the UUID Homebridge had
  already given it, so rooms, scenes and automations are preserved and nothing
  has to be paired again.
- **Start-up validation** of every platform device, reported in the log.
- A device configured both as an accessory and as a platform device is
  reported in the log, as is a platform block that mistakenly uses the
  accessory alias.

### Changed

- The settings UI adapts to the configuration in use. With only accessory
  blocks it is unchanged apart from one **About platform mode** link at the
  bottom of the list — no banner, no badges, no renamed buttons. Once a
  platform block exists it gains a settings page for the broker defaults, a
  container label on each card, and a single **Save all changes** button that
  writes both formats (the Homebridge UI's own Save button is disabled while
  that would only save part of the configuration).
- Received messages are routed by topic lookup rather than by scanning every
  subscription, so a connection shared by many devices dispatches as fast as a
  private one.

### Fixed

- Confirmations happen in the page. The Homebridge UI sandboxes plugin
  settings without native dialogs, so **Apply to all** and removing a service
  from a `custom` accessory silently did nothing in 1.0.x.

### Notes

- Accessories running in their own child bridge cannot be moved to platform
  mode: a platform runs in at most one child bridge, and each child bridge is
  paired separately in HomeKit. The settings UI refuses to move them and says
  why.
- On a shared connection the last-will message names the platform rather than
  a single device, and `logMqtt` on any device logs the received messages of
  every device on that connection.

## 1.0.1

### Fixed

- Changes applied through the accessory **Edit as JSON** editor could be lost
  when clicking Save straight afterwards; click-driven edits are now staged
  immediately.
- **Apply JSON** validates its input before applying: a non-empty JSON object
  with a non-empty `name` and `type`, with the accessory alias always restored
  to `mqttthing`. Errors are shown inline and as a toast.

### Added

- Plugin icon and README version badges.

## 1.0.0

Ground-up TypeScript rewrite of
[homebridge-mqttthing](https://github.com/arachnetech/homebridge-mqttthing).
Existing configurations work unchanged.

### Added

- Homebridge 1.8+ and 2.x support, Node 18–24, ES modules, modern HAP APIs.
- Custom configuration UI: searchable accessory list, type-aware editor with a
  topic table, `apply` function editing, full `custom` multi-service support,
  MQTT connection testing and live topic probing.
- Optional outbound publish queue (`publishMinIntervalms`) with per-topic
  coalescing, protecting low-power devices from HomeKit command bursts.

### Fixed

- Long-standing upstream bugs, including spurious colour publishes at startup,
  adaptive lighting turning lights on, temperature range clamping of sensor
  readings, wildcard subscriptions never being dispatched, null-payload
  crashes and history crashes with multiple services. See
  [docs/UpstreamIssues.md](docs/UpstreamIssues.md) for the full list with
  upstream issue references.
