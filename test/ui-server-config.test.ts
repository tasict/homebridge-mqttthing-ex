// Unit tests for the config.json access used by platform mode
// (homebridge-ui/server-lib.mjs), with a fake file system: these functions
// rewrite the user's whole configuration file, so every guardrail is pinned.
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain-JS module without type declarations
import {
  findMqttthingPlatformBlocks,
  hashOfBlock,
  readPlatformConfig,
  validatePlatformBlock,
  writePlatformConfig,
} from '../homebridge-ui/server-lib.mjs';

const CONFIG_PATH = '/homebridge/config.json';

interface FakeFs {
  files: Map<string, string>;
  modes: Map<string, number>;
  ops: string[];
  deps: Record<string, (...args: never[]) => Promise<unknown>>;
}

function fakeFs(initial: Record<string, unknown> | string): FakeFs {
  const files = new Map<string, string>();
  const modes = new Map<string, number>();
  const ops: string[] = [];
  files.set(CONFIG_PATH, typeof initial === 'string' ? initial : JSON.stringify(initial, null, 4) + '\n');
  modes.set(CONFIG_PATH, 0o644);

  const deps = {
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error('ENOENT: no such file');
      }
      return content;
    },
    writeFile: async (path: string, content: string) => {
      ops.push(`write:${path}`);
      files.set(path, content);
    },
    rename: async (from: string, to: string) => {
      ops.push(`rename:${from}->${to}`);
      files.set(to, files.get(from)!);
      files.delete(from);
      modes.set(to, modes.get(from) ?? 0o644);
    },
    copyFile: async (from: string, to: string) => {
      ops.push(`backup:${to}`);
      files.set(to, files.get(from)!);
    },
    stat: async (path: string) => ({ mode: modes.get(path) ?? 0o644 }),
    chmod: async (path: string, mode: number) => {
      ops.push(`chmod:${path}`);
      modes.set(path, mode);
    },
    unlink: async (path: string) => {
      ops.push(`unlink:${path}`);
      files.delete(path);
    },
  } as unknown as FakeFs['deps'];

  return { files, modes, ops, deps };
}

function configOf(fs: FakeFs): Record<string, unknown> {
  return JSON.parse(fs.files.get(CONFIG_PATH)!) as Record<string, unknown>;
}

const platformBlock = (extra: Record<string, unknown> = {}) => ({
  platform: 'mqttthing-ex',
  devices: [{ name: 'Lamp', type: 'lightbulb' }],
  ...extra,
});

describe('findMqttthingPlatformBlocks', () => {
  it('finds the block with its position, ignoring other plugins', () => {
    const config = { platforms: [{ platform: 'other' }, platformBlock()] };
    const found = findMqttthingPlatformBlocks(config);
    expect(found).toHaveLength(1);
    expect(found[0].index).toBe(1);
  });

  it('copes with a missing or non-array platforms key', () => {
    expect(findMqttthingPlatformBlocks({})).toEqual([]);
    expect(findMqttthingPlatformBlocks({ platforms: 'nope' })).toEqual([]);
    expect(findMqttthingPlatformBlocks(null)).toEqual([]);
  });
});

describe('readPlatformConfig', () => {
  it('reports no block when the configuration has none', async () => {
    const fs = fakeFs({ accessories: [], platforms: [{ platform: 'other' }] });
    await expect(readPlatformConfig(fs.deps.readFile, CONFIG_PATH)).resolves.toEqual({
      exists: false,
      block: null,
      hash: null,
    });
  });

  it('returns the block verbatim with a stable hash', async () => {
    const fs = fakeFs({ platforms: [platformBlock({ url: 'mqtt://b' })] });
    const first = await readPlatformConfig(fs.deps.readFile, CONFIG_PATH);
    expect(first.exists).toBe(true);
    expect(first.block).toEqual(platformBlock({ url: 'mqtt://b' }));
    expect(first.hash).toBe(hashOfBlock(first.block));

    const second = await readPlatformConfig(fs.deps.readFile, CONFIG_PATH);
    expect(second.hash).toBe(first.hash);
  });

  it('refuses when the configuration holds more than one mqttthing block', async () => {
    const fs = fakeFs({ platforms: [platformBlock(), platformBlock()] });
    await expect(readPlatformConfig(fs.deps.readFile, CONFIG_PATH)).rejects.toThrow('Merge them into one');
  });

  it('refuses an unparseable configuration', async () => {
    const fs = fakeFs('{ not json');
    await expect(readPlatformConfig(fs.deps.readFile, CONFIG_PATH)).rejects.toThrow('Refusing to touch it');
  });

  it('explains a missing config path', async () => {
    const fs = fakeFs({});
    await expect(readPlatformConfig(fs.deps.readFile, '')).rejects.toThrow('newer homebridge-config-ui-x');
  });
});

describe('validatePlatformBlock', () => {
  it('forces the platform alias', () => {
    expect(validatePlatformBlock({ platform: 'wrong', devices: [] }).platform).toBe('mqttthing-ex');
  });

  it('rejects malformed blocks and devices', () => {
    expect(() => validatePlatformBlock(null)).toThrow('must be a JSON object');
    expect(() => validatePlatformBlock([])).toThrow('must be a JSON object');
    expect(() => validatePlatformBlock({ url: 5 })).toThrow('"url" must be a string');
    expect(() => validatePlatformBlock({ mqttOptions: [] })).toThrow('"mqttOptions" must be a JSON object');
    expect(() => validatePlatformBlock({ devices: 'no' })).toThrow('"devices" must be an array');
    expect(() => validatePlatformBlock({ devices: [null] })).toThrow('devices[0] must be a JSON object');
    expect(() => validatePlatformBlock({ devices: [{ name: '  ' }] })).toThrow('non-empty "name"');
  });

  it('rejects a device that still carries an accessory alias', () => {
    expect(() => validatePlatformBlock({ devices: [{ name: 'A', accessory: 'mqttthing' }] })).toThrow(
      'must not have an "accessory" property',
    );
  });

  it('rejects invalid and duplicate ids', () => {
    expect(() => validatePlatformBlock({ devices: [{ name: 'A', id: '' }] })).toThrow('invalid "id"');
    expect(() =>
      validatePlatformBlock({ devices: [{ name: 'A', id: 'x' }, { name: 'B', id: 'x' }] }),
    ).toThrow('reuses the id "x"');
  });

  it('rejects an implausibly large block', () => {
    const devices = [{ name: 'A', type: 'switch', note: 'x'.repeat(2_000_001) }];
    expect(() => validatePlatformBlock({ devices })).toThrow('too large');
  });
});

describe('writePlatformConfig', () => {
  it('adds the block without touching anything else', async () => {
    const fs = fakeFs({
      bridge: { name: 'Homebridge' },
      accessories: [{ accessory: 'mqttthing', name: 'Legacy' }],
      platforms: [{ platform: 'other', keep: true }],
      unknownTopLevelKey: { untouched: 1 },
    });

    const result = await writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null);

    const written = configOf(fs);
    expect(written.bridge).toEqual({ name: 'Homebridge' });
    expect(written.accessories).toEqual([{ accessory: 'mqttthing', name: 'Legacy' }]);
    expect(written.unknownTopLevelKey).toEqual({ untouched: 1 });
    expect(written.platforms).toEqual([{ platform: 'other', keep: true }, platformBlock()]);
    expect(result.hash).toBe(hashOfBlock(platformBlock()));
  });

  it('replaces the block in place, keeping its position', async () => {
    const existing = platformBlock({ url: 'mqtt://old' });
    const fs = fakeFs({ platforms: [existing, { platform: 'other' }] });

    await writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock({ url: 'mqtt://new' }), hashOfBlock(existing));

    const written = configOf(fs);
    expect((written.platforms as Array<Record<string, unknown>>)[0].url).toBe('mqtt://new');
    expect((written.platforms as Array<Record<string, unknown>>)[1]).toEqual({ platform: 'other' });
  });

  it('creates the platforms array when the configuration has none', async () => {
    const fs = fakeFs({ accessories: [] });
    await writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null);
    expect(configOf(fs).platforms).toEqual([platformBlock()]);
  });

  it('returns a hash the next read agrees with', async () => {
    const fs = fakeFs({});
    const { hash } = await writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null);
    const read = await readPlatformConfig(fs.deps.readFile, CONFIG_PATH);
    expect(read.hash).toBe(hash);
  });

  it('refuses when the block changed since it was read', async () => {
    const fs = fakeFs({ platforms: [platformBlock({ url: 'mqtt://disk' })] });
    await expect(
      writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock({ url: 'mqtt://mine' }), hashOfBlock(platformBlock())),
    ).rejects.toThrow('changed outside this editor');
    expect(configOf(fs).platforms).toEqual([platformBlock({ url: 'mqtt://disk' })]);
  });

  it('refuses when a block appeared while the editor was open', async () => {
    const fs = fakeFs({ platforms: [platformBlock()] });
    await expect(writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null)).rejects.toThrow(
      'changed outside this editor',
    );
  });

  it('refuses when the block disappeared while the editor was open', async () => {
    const fs = fakeFs({ platforms: [] });
    await expect(
      writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), hashOfBlock(platformBlock())),
    ).rejects.toThrow('changed outside this editor');
  });

  it('refuses to write over an unparseable configuration', async () => {
    const fs = fakeFs('{ broken');
    await expect(writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null)).rejects.toThrow(
      'Refusing to touch it',
    );
    expect(fs.files.get(CONFIG_PATH)).toBe('{ broken');
  });

  it('refuses when platforms is not an array', async () => {
    const fs = fakeFs({ platforms: { platform: 'mqttthing-ex' } });
    await expect(writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null)).rejects.toThrow(
      'not an array. Refusing to touch it',
    );
  });

  it('refuses a malformed block before writing anything', async () => {
    const fs = fakeFs({ accessories: [] });
    await expect(
      writePlatformConfig(fs.deps, CONFIG_PATH, { devices: [{ noName: true }] }, null),
    ).rejects.toThrow('non-empty "name"');
    expect(fs.ops).toEqual([]);
  });

  it('is not fooled by a configuration file with different formatting', async () => {
    // two-space indentation on disk: reserializing grows the file, which must
    // not read as data loss in either direction
    const fs = fakeFs(JSON.stringify({ accessories: [{ accessory: 'mqttthing', name: 'A' }] }, null, 2));
    await expect(writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null)).resolves.toBeDefined();
  });

  it('allows emptying a large block, which shrinks the file legitimately', async () => {
    const many = {
      platform: 'mqttthing-ex',
      devices: Array.from({ length: 200 }, (_, i) => ({
        name: `Device ${i}`,
        type: 'switch',
        topics: { getOn: `home/device/${i}/state`, setOn: `home/device/${i}/set` },
      })),
    };
    const fs = fakeFs({ accessories: [], platforms: [many] });

    await expect(
      writePlatformConfig(fs.deps, CONFIG_PATH, { platform: 'mqttthing-ex', devices: [] }, hashOfBlock(many)),
    ).resolves.toBeDefined();
    expect((configOf(fs).platforms as Array<Record<string, unknown>>)[0].devices).toEqual([]);
  });

  it('keeps a large unrelated configuration intact while emptying the block', async () => {
    const other = Array.from({ length: 200 }, (_, i) => ({ accessory: 'other', name: `A${i}` }));
    const fs = fakeFs({ accessories: other, platforms: [{ platform: 'first' }, platformBlock()] });

    await writePlatformConfig(
      fs.deps,
      CONFIG_PATH,
      { platform: 'mqttthing-ex', devices: [] },
      hashOfBlock(platformBlock()),
    );

    const written = configOf(fs);
    expect(written.accessories).toEqual(other);
    expect((written.platforms as Array<Record<string, unknown>>)[0]).toEqual({ platform: 'first' });
  });

  it('backs up, writes to a temporary file, preserves the mode and renames', async () => {
    const fs = fakeFs({ accessories: [] });
    fs.modes.set(CONFIG_PATH, 0o600);

    await writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null);

    expect(fs.ops).toEqual([
      `backup:${CONFIG_PATH}.bak-mqttthing`,
      `write:${CONFIG_PATH}.tmp-mqttthing`,
      `chmod:${CONFIG_PATH}.tmp-mqttthing`,
      `rename:${CONFIG_PATH}.tmp-mqttthing->${CONFIG_PATH}`,
    ]);
    expect(fs.files.has(`${CONFIG_PATH}.bak-mqttthing`)).toBe(true);
    expect(fs.files.has(`${CONFIG_PATH}.tmp-mqttthing`)).toBe(false);
    expect(fs.modes.get(CONFIG_PATH)).toBe(0o600);
  });

  it('cleans up the temporary file when the rename fails', async () => {
    const fs = fakeFs({ accessories: [] });
    const deps = { ...fs.deps, rename: async () => { throw new Error('disk full'); } };

    await expect(writePlatformConfig(deps as never, CONFIG_PATH, platformBlock(), null)).rejects.toThrow('disk full');
    expect(fs.ops).toContain(`unlink:${CONFIG_PATH}.tmp-mqttthing`);
    expect(configOf(fs).platforms).toBeUndefined();
  });

  it('writes four-space indented JSON with a trailing newline', async () => {
    const fs = fakeFs({ accessories: [] });
    await writePlatformConfig(fs.deps, CONFIG_PATH, platformBlock(), null);
    const raw = fs.files.get(CONFIG_PATH)!;
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n    "platforms"');
  });
});
