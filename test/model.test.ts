// Tests for the declarative accessory-type model (src/model): coverage of
// the runtime service registry, topic-key completeness against the service
// sources, config validation (F13) and the fallback schema generator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// registers all runtime service builders
import '../src/services/index.js';
import { getServiceBuilder } from '../src/services/registry.js';

import { GLOBAL_OPTIONS, GLOBAL_TOPICS } from '../src/model/model-types.js';
import { ACCESSORY_TYPES, ALL_TYPE_IDS, getTypeModel } from '../src/model/types.js';
import { validateThingConfig } from '../src/model/validate.js';
import { generateConfigSchema } from '../src/model/schema.js';
import type { ThingConfig } from '../src/config.js';

const servicesDir = fileURLToPath(new URL('../src/services', import.meta.url));

function readServiceSources(): string[] {
  return fs
    .readdirSync(servicesDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(path.join(servicesDir, name), 'utf8'));
}

function scanRegisteredTypes(): Set<string> {
  const types = new Set<string>();
  for (const source of readServiceSources()) {
    for (const match of source.matchAll(/registerServiceType\(\s*'([^']+)'/g)) {
      types.add(match[1]);
    }
  }
  return types;
}

function scanTopicKeys(): Set<string> {
  const keys = new Set<string>();
  for (const source of readServiceSources()) {
    for (const match of source.matchAll(/\btopics[?!]*\.((?:get|set)[A-Za-z0-9_]+)/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function modelTopicKeys(): Set<string> {
  const keys = new Set<string>();
  for (const type of ACCESSORY_TYPES) {
    for (const topic of type.topics) {
      keys.add(topic.key);
    }
  }
  for (const topic of GLOBAL_TOPICS) {
    keys.add(topic.key);
  }
  return keys;
}

describe('model <-> runtime registry coverage', () => {
  it('has no duplicate type ids', () => {
    expect(new Set(ALL_TYPE_IDS).size).toBe(ALL_TYPE_IDS.length);
  });

  it('covers all 36 runtime types plus custom', () => {
    expect(ALL_TYPE_IDS.length).toBe(37);
    expect(ALL_TYPE_IDS).toContain('custom');
  });

  it('every model entry except custom has a registered service builder', () => {
    for (const id of ALL_TYPE_IDS) {
      if (id === 'custom') {
        // 'custom' is expanded by the accessory itself and has no builder
        expect(getServiceBuilder(id), id).toBeUndefined();
        continue;
      }
      expect(getServiceBuilder(id), `missing service builder for model type '${id}'`).toBeDefined();
    }
  });

  it('every registered runtime type has a model entry', () => {
    const registered = scanRegisteredTypes();
    expect(registered.size).toBeGreaterThanOrEqual(36);
    for (const id of registered) {
      expect(ALL_TYPE_IDS, `missing model entry for registered type '${id}'`).toContain(id);
    }
  });

  it('getTypeModel resolves type-subtype strings like the runtime dispatch', () => {
    expect(getTypeModel('lightbulb-OnOff')?.id).toBe('lightbulb');
    expect(getTypeModel('lightbulb-RGBWW')?.id).toBe('lightbulb');
    expect(getTypeModel('switch')?.id).toBe('switch');
    expect(getTypeModel('nonsense')).toBeUndefined();
    expect(getTypeModel('')).toBeUndefined();
  });

  it('declares every lightbulb subtype alias', () => {
    const aliases = getTypeModel('lightbulb')?.subtypeAliases ?? [];
    expect(aliases).toEqual([
      'lightbulb-OnOff',
      'lightbulb-Dimmable',
      'lightbulb-White',
      'lightbulb-ColTemp',
      'lightbulb-Colour',
      'lightbulb-HSV',
      'lightbulb-RGB',
      'lightbulb-RGBW',
      'lightbulb-RGBWW',
    ]);
  });
});

describe('model topic coverage against service sources', () => {
  it('every topic key read in src/services/*.ts exists in the model or GLOBAL_TOPICS', () => {
    const known = modelTopicKeys();
    const scanned = scanTopicKeys();
    expect(scanned.size).toBeGreaterThan(100);
    const missing = [...scanned].filter((key) => !known.has(key));
    expect(missing, `topic keys read by service code but absent from the model: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps documented defaults for key value arrays', () => {
    const security = getTypeModel('securitySystem')!;
    expect(security.options.find((o) => o.key === 'targetStateValues')?.default).toEqual(['SA', 'AA', 'NA', 'D']);
    expect(security.options.find((o) => o.key === 'currentStateValues')?.default).toEqual(['SA', 'AA', 'NA', 'D', 'T']);

    const thermostat = getTypeModel('thermostat')!;
    expect(thermostat.options.find((o) => o.key === 'minTemperature')?.default).toBe(10);
    expect(thermostat.options.find((o) => o.key === 'maxTemperature')?.default).toBe(38);

    const valve = getTypeModel('valve')!;
    expect(valve.options.find((o) => o.key === 'valveType')?.enumValues).toEqual(['sprinkler', 'shower', 'faucet']);

    const garage = getTypeModel('garageDoorOpener')!;
    expect(garage.options.find((o) => o.key === 'doorCurrentValues')?.default).toEqual(['O', 'C', 'o', 'c', 'S']);
    expect(garage.options.find((o) => o.key === 'lockValues')?.default).toEqual(['U', 'S', 'J', '?']);
  });

  it('models the lower-case carbonMonoxideSensor level topics used by the code', () => {
    const co = getTypeModel('carbonMonoxideSensor')!;
    const keys = co.topics.map((t) => t.key);
    expect(keys).toContain('getcarbonMonoxideLevel');
    expect(keys).toContain('getcarbonMonoxidePeakLevel');
  });
});

describe('validateThingConfig', () => {
  it('errors when topics is missing entirely for a type that requires topics', () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'motionSensor',
      name: 'PIR',
    } as ThingConfig);
    expect(result.errors.some((e) => e.includes("no 'topics' configured"))).toBe(true);
  });

  it('does not require topics for irrigationSystem or custom', () => {
    const irrigation = validateThingConfig({
      accessory: 'mqttthing',
      type: 'irrigationSystem',
      name: 'Garden',
      zones: [],
    } as unknown as ThingConfig);
    expect(irrigation.errors).toEqual([]);
  });

  it('errors when a required topic is missing', () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'contactSensor',
      name: 'Door',
      topics: { getStatusLowBattery: 'home/door/bat' },
    } as ThingConfig);
    expect(result.errors.some((e) => e.includes("required topic 'getContactSensorState'"))).toBe(true);
  });

  it("suggests 'getLockTargetState' for a topic key with trailing whitespace (upstream #366)", () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'lockMechanism',
      name: 'Lock',
      topics: {
        setLockTargetState: 'home/lock/set',
        'getLockTargetState ': 'home/lock/get',
        getLockCurrentState: 'home/lock/current',
      },
    } as ThingConfig);
    expect(result.warnings.some((w) => w.includes("did you mean 'getLockTargetState'?"))).toBe(true);
  });

  it("suggests 'valveType' for the case-wrong option key 'valvetype' (upstream #677)", () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'valve',
      name: 'Sprinkler',
      topics: { setActive: 'v/set', getActive: 'v/get', getInUse: 'v/inuse' },
      valvetype: 'sprinkler',
    } as unknown as ThingConfig);
    expect(result.warnings.some((w) => w.includes("unknown option 'valvetype'") && w.includes("did you mean 'valveType'?"))).toBe(true);
  });

  it('accepts global topics and options without warnings', () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'switch',
      name: 'Switch',
      url: 'mqtt://localhost:1883',
      integerValue: true,
      turnOffAfterms: 1000,
      topics: {
        getOn: 's/get',
        setOn: 's/set',
        getOnline: 's/online',
        getBatteryLevel: 's/battery',
      },
    } as ThingConfig);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('never warns about unknown option keys when a codec is configured', () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'switch',
      name: 'Switch',
      codec: 'my-codec.js',
      myCodecSpecialOption: 42,
      topics: { getOn: 's/get', setOn: 's/set' },
    } as unknown as ThingConfig);
    expect(result.warnings).toEqual([]);
  });

  it('errors on unrecognized types', () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'toaster',
      name: 'T',
      topics: {},
    } as ThingConfig);
    expect(result.errors.some((e) => e.includes("unrecognized accessory type 'toaster'"))).toBe(true);
  });

  it('validates sub-services of a custom accessory', () => {
    const result = validateThingConfig({
      accessory: 'mqttthing',
      type: 'custom',
      name: 'Composite',
      services: [
        { type: 'switch', name: 'Switch 1', topics: { getOn: 'a', setOn: 'b' } },
        { type: 'motionSensor', name: 'PIR', topics: { getmotionDetected: 'c' } },
      ],
    } as unknown as ThingConfig);
    // missing required topic in the second sub-service, plus a near-miss for
    // its case-wrong key
    expect(result.errors.some((e) => e.includes("service 'PIR'") && e.includes('getMotionDetected'))).toBe(true);
    expect(result.warnings.some((w) => w.includes("did you mean 'getMotionDetected'?"))).toBe(true);
  });
});

describe('generateConfigSchema', () => {
  const schema = generateConfigSchema() as {
    pluginAlias: string;
    pluginType: string;
    singular: boolean;
    schema: {
      type: string;
      properties: Record<string, { oneOf?: Array<{ title: string; enum: string[] }>; required?: boolean }>;
    };
  };

  it('has the config-ui-x header fields', () => {
    expect(schema.pluginAlias).toBe('mqttthing');
    expect(schema.pluginType).toBe('accessory');
    expect(schema.singular).toBe(false);
  });

  it('requires name and includes the core properties', () => {
    const properties = schema.schema.properties;
    expect(properties.name.required).toBe(true);
    for (const key of ['type', 'url', 'username', 'password', 'topics', 'logMqtt']) {
      expect(properties[key], `schema property '${key}'`).toBeDefined();
    }
  });

  it('includes every type id plus the lightbulb subtype aliases in the type enum', () => {
    const enumValues = (schema.schema.properties.type.oneOf ?? []).flatMap((choice) => choice.enum);
    for (const id of ALL_TYPE_IDS) {
      expect(enumValues, `type enum should contain '${id}'`).toContain(id);
    }
    for (const alias of getTypeModel('lightbulb')?.subtypeAliases ?? []) {
      expect(enumValues, `type enum should contain '${alias}'`).toContain(alias);
    }
    expect(new Set(enumValues).size).toBe(enumValues.length);
  });
});

describe('model internal consistency', () => {
  it('has consistent topic directions and unique keys per type', () => {
    for (const type of ACCESSORY_TYPES) {
      const seen = new Set<string>();
      for (const topic of type.topics) {
        expect(seen.has(topic.key), `${type.id} duplicates topic '${topic.key}'`).toBe(false);
        seen.add(topic.key);
        const expected = topic.key.startsWith('set') ? 'set' : 'get';
        expect(topic.direction, `${type.id} topic '${topic.key}' direction`).toBe(expected);
      }
      const optionKeys = type.options.map((o) => o.key);
      expect(new Set(optionKeys).size, `${type.id} has duplicate option keys`).toBe(optionKeys.length);
    }
  });

  it('declares enumValues exactly for enum options', () => {
    for (const type of ACCESSORY_TYPES) {
      for (const option of type.options) {
        if (option.type === 'enum') {
          expect(option.enumValues, `${type.id} option '${option.key}' should declare enumValues`).toBeDefined();
        } else {
          expect(option.enumValues, `${type.id} option '${option.key}' should not declare enumValues`).toBeUndefined();
        }
      }
    }
  });

  it('does not shadow global option keys with different types', () => {
    const globalTypes = new Map(GLOBAL_OPTIONS.map((o) => [o.key, o.type]));
    for (const type of ACCESSORY_TYPES) {
      for (const option of type.options) {
        if (globalTypes.has(option.key)) {
          expect(option.type, `${type.id} option '${option.key}' type conflicts with the global option`).toBe(
            globalTypes.get(option.key),
          );
        }
      }
    }
  });
});
