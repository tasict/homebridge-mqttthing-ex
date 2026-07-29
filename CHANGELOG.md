# Changelog

## 1.2.2

### Changed

- **`npm audit` is now clean — zero known vulnerabilities of any severity.**
  The two dependencies responsible for every reported advisory were replaced:
  - **JSONPath expressions are now evaluated by
    [jsonpath-plus](https://github.com/JSONPath-Plus/JSONPath)** instead of
    the unmaintained `jsonpath`, which pinned a known-vulnerable `underscore`
    release with no fixed version reachable. `jsonpath-plus` is actively
    maintained and supports a superset of the original syntax, so existing
    `topic$.path` expressions keep working.
  - **`fakegato-history` (Eve history support) is now vendored** under
    `vendor/fakegato-history` with its optional Google Drive storage backend
    removed. The npm release hard-depends on an old `googleapis` for that
    backend — this plugin only ever stores history on the filesystem, yet the
    unused dependency carried six known-vulnerable transitive packages that
    `overrides` cannot fix from inside a published plugin. The vendored files
    are otherwise byte-for-byte identical to upstream 0.6.7 (MIT, attribution
    in `NOTICE`, details in `vendor/fakegato-history/README.md`).
- **All `MQTTTHING_URL` / `MQTTTHING_USERNAME` / `MQTTTHING_PASSWORD`
  environment lookups now live in one module** (`src/env.ts`), so it is easy
  to verify that nothing else in the plugin touches the environment.
  Behaviour is unchanged.

## 1.2.1

### Fixed

- **The settings UI could report "no devices configured" straight after
  upgrading to 1.2.0.** Nothing was lost — `config.json` was untouched and
  Homebridge kept serving every device. The Homebridge UI caches each plugin's
  `pluginAlias`/`pluginType` for 24 hours and does not invalidate that cache
  when a plugin is updated, so it went on looking in the part of `config.json`
  that 1.1.0 declared. The settings screen now detects that disagreement and
  asks for a restart of the **Homebridge UI** — which is the service holding
  that cache, so restarting Homebridge alone does not clear it — instead of
  showing an empty list with an **Add device** button that would have written
  to the wrong place.

### Documentation

- The README has an **Upgrading from 1.1.x or earlier** section covering the
  one-time Homebridge UI restart.

## 1.2.0

### Changed

- **`config.schema.json` now describes the platform block** (`pluginAlias`
  `mqttthing-ex`, `pluginType` `platform`) instead of an accessory block. This
  is what the Homebridge plugin verification checks require, and it is also
  the right way round: the platform is the format this plugin is built on, and
  declaring it here puts it under the Homebridge UI's own care — including
  **child-bridge management for the platform block**, which was previously
  unavailable.
- **The settings UI swapped which container it manages itself.** The platform
  block now goes through the Homebridge UI's config API, and legacy
  `"accessory": "mqttthing"` entries are read and written by the plugin's own
  UI server (`/config/accessories`), with the same guarded atomic write as
  before: a backup, a hash check against concurrent edits, and a refusal if
  the change would touch anything outside this plugin's blocks. Saving still
  writes the platform block before the accessory blocks, so a device being
  moved is never removed from `accessories[]` until the platform holds it.
- **Configuration is not affected.** Both formats are read exactly as before
  and nothing in `config.json` needs to change.

### Fixed

- The generated schema stated field requirements as `"required": true` on
  individual properties, which is not valid JSON Schema. Requirements are now
  arrays at the object level (`"required": ["name", "type"]`).
- The README claimed the Homebridge UI could not manage a child bridge for the
  platform block. It can, now that the schema declares the platform.

### Added

- `supports-hap` in the package keywords, declaring the transport the plugin
  supports.
- CI builds the settings UI and regenerates the schema on every push, failing
  if the committed `config.schema.json` has drifted.

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
