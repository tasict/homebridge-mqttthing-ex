# Upstream Issue Resolution Tracker

Survey of the 219 open issues in arachnetech/homebridge-mqttthing (as of
2026-07), identifying what homebridge-mqttthing-ex fixes. Root causes were
verified against the upstream source. None of these fixes break existing
configurations; behavior-changing fixes remove unambiguously erroneous
behavior and are called out in the release notes.

## Fix list

| # | Upstream issues | Problem (root cause) | Fix in mqttthing-ex | Status |
|---|---|---|---|---|
| F1 | #567 #552 #617 #686 | Spurious color/state publishes on startup: adaptive-lighting internal color temperature (initialValue 140) recomputes hue/saturation and publishes uninitialized defaults to set topics during service construction | Never publish to set topics during construction; publishes only from HomeKit actions or post-priming adaptive-lighting ticks | implemented (src/services/lightbulb.ts) |
| F2 | #431 #436 | Adaptive lighting publishes color while the light is off (turns devices on); `adaptiveLighting: "false"` (string) not honored | Suppress CT/HSV publishes while off; coerce string booleans | implemented (src/services/lightbulb.ts; string coercion in binding) |
| F3 | #587 #592 #392 | `minTemperature`/`maxTemperature` clamp CurrentTemperature, invalidating real readings and causing characteristicWarnings | Apply configured range only to Target/Threshold characteristics; CurrentTemperature keeps the wide default | planned |
| F4 | #500 (#607) | Wildcard subscriptions (`+`/`#`) never dispatch (exact-key lookup) | MQTT topic-filter matching in dispatch | implemented (src/mqtt) |
| F5 | #605 #201 | `history: true` with multiple same-type services in a custom accessory crashes (duplicate fakegato UUID, no subtype) | Unique subtype per history service | planned (history port) |
| F6 | #463 #414 #556 #525 #529 #520 #530 #667 #695 #455 #578 | Validation cluster: floats rejected for int formats instead of rounding; LightLevel 0 vs HAP min 0.0001; numeric-string config values silently break props; NaN re-warns forever | Central sanitize step: round for int formats, clamp to bounds, coerce numeric strings, drop NaN quietly (debug once per topic) | planned |
| F7 | #438 #458 | Null payloads crash (`message.toString()` unguarded); apply() null/undefined suppression undocumented | Null-safe decode everywhere; document "return undefined/null to ignore" | implemented (src/mqtt) |
| F8 | #711 #554 | Values excluded by `restrictSwitchValues` still pushed to HAP (warnings); shared-topic multi-switch warns per service | Filter disallowed indexes before update; debug-level for intentional filtering | planned |
| F9 | #631 | StatusTampered bound as boolean but HAP format is UINT8 | Emit 0/1 integers (still accept truthy MQTT values) | planned |
| F10 | #440 | Default MQTT client ID can exceed 23 chars / contain invalid chars for strict brokers | Keep default for compatibility; log a helpful hint on identifier-rejected errors; `mqttOptions.clientId` already overrides | planned |
| F11 | #644 | Hardcoded LWT topic `WillMsg` published broker-wide | Document; support disabling via `mqttOptions.will: null/false` cleanly | planned |
| F12 | #606 #670 | Empty URL passes '' to mqtt.connect; AggregateError (IPv6+IPv4 refusal) logged verbatim | Default `mqtt://localhost:1883`; unwrap AggregateError causes in logs | implemented (src/mqtt) |
| F13 | #403 #677 #366 | Missing `topics` object crashes; typo'd/case-wrong topic keys silently ignored | Config validation pass: friendly error for missing required topics; near-miss warnings | planned |
| F14 | #308 | Numeric/boolean config values given as strings silently misbehave | Coerce in config normalization (lenient) | planned |
| F15 | (#78) | fanv2 reads `config.getCurrentFanState` instead of `config.topics.getCurrentFanState` | Accept the correct topics key; keep legacy top-level key working | planned |
| F16 | #619 #347 #342 | Offline devices zero out battery/sensor values | Opt-in: hold last-known values / No Response when offline | backlog (opt-in) |

## Already addressed by the rewrite (release-note references)

- Homebridge 2.0 compatibility: #681, #609
- Node 18-24 engines: #689
- Modern mqtt.js (TLS against Mosquitto 2.x, resubscribe on reconnect): #437
- Custom config UI (schema UI destroys `apply()` configs, cannot express `custom`, missing types/options): #709, #700, #614, #453, #383
- Outbound publish queue (device flooding, command bursts): #648, #641, #545
- Modern onGet/onSet push model (toggle bounce-back, laggy reads): #533, #666, #270
- Maintained successor: #715

## Popular opt-in feature requests (backlog, by demand)

1. #258 MQTT autodiscovery (HA convention)
2. #493 Global broker config / shared MQTT connections
3. #245 #342 #381 State persistence across restarts
4. #580 #623 `lockAfterms` auto-relock; #636 `turnOnAfterms`
5. #386 Thermostat separate heat/cool setpoint topics (Auto mode)
6. #397 `invertPosition` for window coverings
7. #348 #395 Accessory information via MQTT topics
8. #370 #471 #170 apply() ergonomics (log access, init hook, applyTopic)
9. #343 Read-only accessories; #346 `minStep`
10. #673 Multi-topic publish per property
11. #565 Battery topics on all types
12. #398 #460 RGB/CCT channel improvements
13. #523 FilterMaintenance; #277 Valve WaterLevel; #353 per-event topics; #435 startPub delay
