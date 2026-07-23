// Unit tests for the custom UI's pure logic (ui/src/lib) and the schema
// document builder. The highest-priority property is the NON-DESTRUCTIVE
// round-trip: editing must never touch keys the UI does not model.
import { describe, expect, it } from 'vitest';

import type { ThingConfig } from '../src/config.js';
import { generateConfigSchema } from '../src/model/schema.js';
import { checkApplySyntax } from '../ui/src/lib/apply-check.js';
import {
  changeAccessoryType,
  deepClone,
  duplicateName,
  matchesSearch,
  mostCommonBroker,
  probeTopicFor,
  replaceConfigContents,
  setOption,
  setTopic,
  setTopicApply,
  topicApply,
  topicString,
} from '../ui/src/lib/config-ops.js';
import { buildTopicRows } from '../ui/src/lib/topic-rows.js';
import { summarizeConfig } from '../ui/src/lib/validation.js';
// @ts-expect-error plain-JS module without type declarations
import { buildSchemaDocument } from '../scripts/generate-schema.mjs';

describe('ui-lib: non-destructive round-trip', () => {
  function fixture(): ThingConfig {
    return {
      accessory: 'mqttthing',
      type: 'switch',
      name: 'Garage Power',
      url: 'mqtt://10.0.0.2',
      topics: {
        getOn: { topic: 'garage/power/state', apply: 'return JSON.parse(message).on;', customKey: [1, 2] },
        setOn: 'garage/power/set',
      },
      codec: 'my-codec.js',
      codecOptions: { nested: { deep: true }, list: ['a', 'b'] },
      someUnknownKey: 'must survive',
      anotherUnknown: { x: 1 },
      integerValue: true,
    } as ThingConfig;
  }

  it('editing one topic leaves every other key byte-identical', () => {
    const config = fixture();
    const before = deepClone(config);

    setTopic(config, 'setOn', 'garage/power/command');

    expect(config.topics!.setOn).toBe('garage/power/command');
    // every key except the edited one is untouched
    for (const key of Object.keys(before)) {
      if (key !== 'topics') {
        expect(JSON.stringify(config[key])).toBe(JSON.stringify(before[key]));
      }
    }
    expect(JSON.stringify(config.topics!.getOn)).toBe(JSON.stringify(before.topics!.getOn));
  });

  it('editing the topic string of an extended topic preserves apply and unknown keys in the object', () => {
    const config = fixture();
    setTopic(config, 'getOn', 'garage/newstate');
    const spec = config.topics!.getOn as Record<string, unknown>;
    expect(spec.topic).toBe('garage/newstate');
    expect(spec.apply).toBe('return JSON.parse(message).on;');
    expect(spec.customKey).toEqual([1, 2]);
  });

  it('clearing apply collapses {topic} to a plain string only when nothing else remains', () => {
    const config = fixture();
    // getOn carries customKey -> object must survive
    setTopicApply(config, 'getOn', '');
    const spec = config.topics!.getOn as Record<string, unknown>;
    expect(typeof spec).toBe('object');
    expect('apply' in spec).toBe(false);
    expect(spec.customKey).toEqual([1, 2]);

    // a pure {topic, apply} object collapses back to a string
    config.topics!.setOn = { topic: 'garage/power/set', apply: 'return message;' };
    setTopicApply(config, 'setOn', '');
    expect(config.topics!.setOn).toBe('garage/power/set');
  });

  it('adding apply to a plain string upgrades it to the extended form', () => {
    const config = fixture();
    setTopicApply(config, 'setOn', 'return message === true ? "ON" : "OFF";');
    expect(config.topics!.setOn).toEqual({
      topic: 'garage/power/set',
      apply: 'return message === true ? "ON" : "OFF";',
    });
  });

  it('clearing a plain topic deletes the key; clearing an extended topic with extras keeps the object', () => {
    const config = fixture();
    setTopic(config, 'setOn', '');
    expect('setOn' in config.topics!).toBe(false);
    setTopic(config, 'getOn', '');
    const spec = config.topics!.getOn as Record<string, unknown>;
    expect(spec.topic).toBe('');
    expect(spec.apply).toBeDefined();
  });

  it('setOption assigns and deletes without touching other keys', () => {
    const config = fixture();
    const before = deepClone(config);
    setOption(config, 'logMqtt', true);
    expect(config.logMqtt).toBe(true);
    setOption(config, 'logMqtt', undefined);
    expect('logMqtt' in config).toBe(false);
    expect(JSON.stringify(config)).toBe(JSON.stringify(before));
  });

  it('replaceConfigContents keeps the object identity', () => {
    const config = fixture();
    const reference = config;
    replaceConfigContents(config, { accessory: 'mqttthing', type: 'switch', name: 'New' });
    expect(reference).toBe(config);
    expect(Object.keys(config).sort()).toEqual(['accessory', 'name', 'type']);
  });
});

describe('ui-lib: search and list operations', () => {
  const configs: ThingConfig[] = [
    { accessory: 'mqttthing', type: 'lightbulb-RGB', name: 'Kitchen Light', url: 'mqtt://a', topics: { setRGB: 'kitchen/rgb' } },
    { accessory: 'mqttthing', type: 'switch', name: 'Heater', url: 'mqtt://b', username: 'u', topics: { getOn: { topic: 'heat/state' } } },
    {
      accessory: 'mqttthing',
      type: 'custom',
      name: 'Multi',
      url: 'mqtt://b',
      username: 'u',
      services: [{ type: 'switch', name: 'Sub', topics: { setOn: 'multi/sub/set' } } as ThingConfig],
    },
  ];

  it('matches by name, type and topic strings (case-insensitive)', () => {
    expect(matchesSearch(configs[0], 'kitchen')).toBe(true);
    expect(matchesSearch(configs[0], 'LIGHTBULB')).toBe(true);
    expect(matchesSearch(configs[0], 'kitchen/rgb')).toBe(true);
    expect(matchesSearch(configs[1], 'heat/state')).toBe(true); // extended topic object
    expect(matchesSearch(configs[2], 'multi/sub')).toBe(true); // sub-service topic
    expect(matchesSearch(configs[0], 'garage')).toBe(false);
    expect(matchesSearch(configs[0], '')).toBe(true);
  });

  it('generates duplicate names that avoid collisions', () => {
    expect(duplicateName(['Lamp'], 'Lamp')).toBe('Lamp copy');
    expect(duplicateName(['Lamp', 'Lamp copy'], 'Lamp')).toBe('Lamp copy 2');
    expect(duplicateName(['Lamp', 'Lamp copy', 'Lamp copy 2'], 'Lamp')).toBe('Lamp copy 3');
  });

  it('finds the most common broker for the add wizard', () => {
    expect(mostCommonBroker(configs)).toEqual({ url: 'mqtt://b', username: 'u' });
    expect(mostCommonBroker([])).toBeUndefined();
    expect(mostCommonBroker([{ accessory: 'mqttthing', type: 'switch', name: 'x' }])).toBeUndefined();
  });
});

describe('ui-lib: type change preserves compatible topics', () => {
  it('keeps topics known to the new type and global topics, drops the rest', () => {
    const config: ThingConfig = {
      accessory: 'mqttthing',
      type: 'thermostat',
      name: 'T',
      topics: {
        getCurrentTemperature: 'home/temp',
        getTargetTemperature: 'home/target',
        getOnline: 'home/online',
        getOn: { topic: 'home/on', apply: 'return message;' },
      },
    };
    const dropped = changeAccessoryType(config, 'switch');
    expect(config.type).toBe('switch');
    expect(dropped.sort()).toEqual(['getCurrentTemperature', 'getTargetTemperature']);
    expect(config.topics!.getOnline).toBe('home/online'); // global topic kept
    expect(config.topics!.getOn).toEqual({ topic: 'home/on', apply: 'return message;' });
  });

  it('resolves subtype aliases and keeps everything when switching to custom', () => {
    const config: ThingConfig = {
      accessory: 'mqttthing',
      type: 'switch',
      name: 'S',
      topics: { getOn: 'a', setOn: 'b' },
    };
    expect(changeAccessoryType(config, 'lightbulb-RGB')).toEqual([]);
    expect(config.type).toBe('lightbulb-RGB');
    expect(config.topics).toEqual({ getOn: 'a', setOn: 'b' });

    const custom = deepClone(config);
    expect(changeAccessoryType(custom, 'custom')).toEqual([]);
    expect(custom.topics).toEqual({ getOn: 'a', setOn: 'b' });
  });
});

describe('ui-lib: topic helpers', () => {
  it('reads topic strings and apply bodies from both forms', () => {
    expect(topicString('a/b')).toBe('a/b');
    expect(topicString({ topic: 'a/b', apply: 'return 1;' })).toBe('a/b');
    expect(topicString(undefined)).toBe('');
    expect(topicApply('a/b')).toBeUndefined();
    expect(topicApply({ topic: 'a/b', apply: 'return 1;' })).toBe('return 1;');
  });

  it('strips JSONPath suffixes for the probe topic', () => {
    expect(probeTopicFor('sensor/data $.temperature')).toBe('sensor/data');
    expect(probeTopicFor('sensor/data')).toBe('sensor/data');
    expect(probeTopicFor({ topic: 'sensor/data$.x' })).toBe('sensor/data');
    expect(probeTopicFor(undefined)).toBe('');
  });
});

describe('ui-lib: topic row pairing', () => {
  it('pairs get/set keys into one row and sorts required rows first', () => {
    const { rows, globals } = buildTopicRows('windowCovering');
    const target = rows.find((r) => r.id === 'TargetPosition');
    expect(target).toBeDefined();
    expect(target!.set!.key).toBe('setTargetPosition');
    expect(target!.get!.key).toBe('getTargetPosition');
    expect(target!.required).toBe(true);
    expect(rows[0].required).toBe(true); // required first
    expect(globals.some((r) => r.get?.key === 'getOnline')).toBe(true);
  });

  it('handles subtype aliases and unknown types', () => {
    expect(buildTopicRows('lightbulb-RGB').rows.some((r) => r.id === 'RGB')).toBe(true);
    expect(buildTopicRows('nope').rows).toEqual([]);
  });

  it('does not duplicate global rows already defined by the type', () => {
    const { rows, globals } = buildTopicRows('battery');
    expect(rows.some((r) => r.get?.key === 'getBatteryLevel')).toBe(true);
    expect(globals.some((r) => r.get?.key === 'getBatteryLevel')).toBe(false);
  });
});

describe('ui-lib: apply syntax check', () => {
  it('accepts valid bodies and empty input', () => {
    expect(checkApplySyntax('return JSON.parse(message).x;')).toBeNull();
    expect(checkApplySyntax('')).toBeNull();
    expect(checkApplySyntax('   ')).toBeNull();
  });

  it('reports syntax errors', () => {
    const error = checkApplySyntax('return JSON.parse(message');
    expect(error).toBeTruthy();
    expect(typeof error).toBe('string');
  });
});

describe('ui-lib: validation display mapping', () => {
  it('maps near-miss suggestions through to the display', () => {
    const summary = summarizeConfig({
      accessory: 'mqttthing',
      type: 'valve',
      name: 'Sprinkler',
      valvetype: 'sprinkler', // wrong case: near-miss of valveType
      topics: { setActive: 'x' },
    } as ThingConfig);
    expect(summary.warnings.some((w) => w.includes("did you mean 'valveType'"))).toBe(true);
    expect(summary.total).toBe(summary.errors.length + summary.warnings.length);
  });

  it('reports missing name and missing required topics as errors', () => {
    const summary = summarizeConfig({ accessory: 'mqttthing', type: 'motionSensor', name: '', topics: {} } as ThingConfig);
    expect(summary.errors.some((e) => e.includes('no name'))).toBe(true);
    expect(summary.errors.some((e) => e.includes('getMotionDetected'))).toBe(true);
  });

  it('never throws for unknown types', () => {
    const summary = summarizeConfig({ accessory: 'mqttthing', type: 'flying-carpet', name: 'X' } as ThingConfig);
    expect(summary.errors.length).toBeGreaterThan(0);
  });
});

describe('generate-schema: document shape', () => {
  it('produces the mqttthing fallback schema with the custom UI enabled', () => {
    const document = buildSchemaDocument(generateConfigSchema()) as Record<string, any>;
    expect(document.pluginAlias).toBe('mqttthing');
    expect(document.pluginType).toBe('accessory');
    expect(document.singular).toBe(false);
    expect(document.customUi).toBe(true);
    expect(document.customUiPath).toBe('./homebridge-ui');
    expect(document.schema.properties.name.required).toBe(true);
    const typeIds = (document.schema.properties.type.oneOf as { enum: string[] }[]).flatMap((c) => c.enum);
    expect(typeIds).toContain('lightbulb');
    expect(typeIds).toContain('lightbulb-RGB');
    expect(typeIds).toContain('custom');
    expect(typeIds).toContain('carbonMonoxideSensor');
  });
});
