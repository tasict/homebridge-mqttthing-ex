// Unit tests for the config.json access used for legacy accessory blocks
// (homebridge-ui/server-lib.mjs), with a fake file system: these functions
// rewrite the user's whole configuration file, so every guardrail is pinned.
//
// The platform block is not touched here - homebridge-config-ui-x owns it,
// because the plugin's schema declares a platform pluginType.
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain-JS module without type declarations
import {
  findMqttthingAccessoryBlocks,
  findMqttthingPlatformBlock,
  hashOfBlock,
  readAccessoryConfig,
  validateAccessoryBlocks,
  writeAccessoryConfig,
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

function accessoriesOf(fs: FakeFs): Array<Record<string, unknown>> {
  return configOf(fs).accessories as Array<Record<string, unknown>>;
}

const block = (name: string, extra: Record<string, unknown> = {}) => ({
  accessory: 'mqttthing',
  name,
  type: 'lightbulb',
  ...extra,
});

/** Hash of "no blocks at all", which is what a fresh configuration reads as. */
const EMPTY_HASH = hashOfBlock([]) as string;

describe('findMqttthingAccessoryBlocks', () => {
  it('finds the blocks with their positions, ignoring other plugins', () => {
    const config = { accessories: [{ accessory: 'other' }, block('A'), { accessory: 'other' }, block('B')] };
    const found = findMqttthingAccessoryBlocks(config);
    expect(found).toHaveLength(2);
    expect(found.map((entry: { index: number }) => entry.index)).toEqual([1, 3]);
  });

  it('copes with a missing or non-array accessories key', () => {
    expect(findMqttthingAccessoryBlocks({})).toEqual([]);
    expect(findMqttthingAccessoryBlocks({ accessories: 'nope' })).toEqual([]);
    expect(findMqttthingAccessoryBlocks(null)).toEqual([]);
  });
});

describe('findMqttthingPlatformBlock', () => {
  // The UI compares this against what homebridge-config-ui-x hands it: the two
  // disagree while config-ui-x still holds the pluginAlias/pluginType it
  // cached before this plugin was upgraded.
  it('finds our platform block, ignoring other plugins', () => {
    const ours = { platform: 'mqttthing-ex', devices: [] };
    expect(findMqttthingPlatformBlock({ platforms: [{ platform: 'other' }, ours] })).toBe(ours);
  });

  it('returns null when there is none, or no platforms array at all', () => {
    expect(findMqttthingPlatformBlock({ platforms: [{ platform: 'other' }] })).toBeNull();
    expect(findMqttthingPlatformBlock({})).toBeNull();
    expect(findMqttthingPlatformBlock({ platforms: 'nope' })).toBeNull();
    expect(findMqttthingPlatformBlock(null)).toBeNull();
  });

  it('does not mistake the accessory alias for the platform alias', () => {
    expect(findMqttthingPlatformBlock({ platforms: [{ platform: 'mqttthing', devices: [] }] })).toBeNull();
  });
});

describe('readAccessoryConfig', () => {
  it('reports an empty list when the configuration has none', async () => {
    const fs = fakeFs({ accessories: [{ accessory: 'other' }], platforms: [] });
    await expect(readAccessoryConfig(fs.deps.readFile, CONFIG_PATH)).resolves.toEqual({
      blocks: [],
      hash: EMPTY_HASH,
      platform: { present: false, devices: 0 },
    });
  });

  it('reports what config.json says about the platform block', async () => {
    const fs = fakeFs({
      platforms: [{ platform: 'other' }, { platform: 'mqttthing-ex', devices: [{ name: 'A' }, { name: 'B' }] }],
    });
    const read = await readAccessoryConfig(fs.deps.readFile, CONFIG_PATH);
    expect(read.platform).toEqual({ present: true, devices: 2 });
  });

  it('reports a platform block with no devices array as present but empty', async () => {
    const fs = fakeFs({ platforms: [{ platform: 'mqttthing-ex' }] });
    const read = await readAccessoryConfig(fs.deps.readFile, CONFIG_PATH);
    expect(read.platform).toEqual({ present: true, devices: 0 });
  });

  it('returns the blocks verbatim, in order, with a stable hash', async () => {
    const fs = fakeFs({ accessories: [block('A', { url: 'mqtt://b' }), { accessory: 'other' }, block('B')] });
    const first = await readAccessoryConfig(fs.deps.readFile, CONFIG_PATH);
    expect(first.blocks).toEqual([block('A', { url: 'mqtt://b' }), block('B')]);
    expect(first.hash).toBe(hashOfBlock(first.blocks));

    const second = await readAccessoryConfig(fs.deps.readFile, CONFIG_PATH);
    expect(second.hash).toBe(first.hash);
  });

  it('refuses an unparseable configuration', async () => {
    const fs = fakeFs('{ not json');
    await expect(readAccessoryConfig(fs.deps.readFile, CONFIG_PATH)).rejects.toThrow('Refusing to touch it');
  });

  it('explains a platform block that uses the accessory alias by mistake', async () => {
    const fs = fakeFs({ platforms: [{ platform: 'mqttthing', devices: [{ name: 'Lamp' }] }] });
    await expect(readAccessoryConfig(fs.deps.readFile, CONFIG_PATH)).rejects.toThrow(
      '"mqttthing" is the accessory alias',
    );
  });

  it('leaves another plugin’s platform named mqttthing alone', async () => {
    // no devices array, so it is not ours to complain about
    const fs = fakeFs({ platforms: [{ platform: 'mqttthing', somethingElse: true }] });
    await expect(readAccessoryConfig(fs.deps.readFile, CONFIG_PATH)).resolves.toEqual({
      blocks: [],
      hash: EMPTY_HASH,
      platform: { present: false, devices: 0 },
    });
  });

  it('explains a missing config path', async () => {
    const fs = fakeFs({});
    await expect(readAccessoryConfig(fs.deps.readFile, '')).rejects.toThrow('newer homebridge-config-ui-x');
  });
});

describe('validateAccessoryBlocks', () => {
  it('forces the accessory alias', () => {
    const [validated] = validateAccessoryBlocks([{ accessory: 'wrong', name: 'A', type: 'switch' }]);
    expect(validated.accessory).toBe('mqttthing');
  });

  it('rejects anything that is not an array of objects', () => {
    expect(() => validateAccessoryBlocks(null)).toThrow('must be a JSON array');
    expect(() => validateAccessoryBlocks({})).toThrow('must be a JSON array');
    expect(() => validateAccessoryBlocks([null])).toThrow('accessories[0] must be a JSON object');
    expect(() => validateAccessoryBlocks([[]])).toThrow('accessories[0] must be a JSON object');
  });

  it('requires a non-empty name and type on every block', () => {
    expect(() => validateAccessoryBlocks([{ type: 'switch' }])).toThrow('accessories[0] must have a non-empty "name"');
    expect(() => validateAccessoryBlocks([{ name: '  ', type: 'switch' }])).toThrow('non-empty "name"');
    expect(() => validateAccessoryBlocks([{ name: 'A' }])).toThrow('("A") must have a non-empty "type"');
    expect(() => validateAccessoryBlocks([{ name: 'A', type: '  ' }])).toThrow('non-empty "type"');
  });

  it('reports the position of the offending block', () => {
    expect(() => validateAccessoryBlocks([block('A'), { name: 'B' }])).toThrow('accessories[1]');
  });

  it('rejects an implausibly large configuration', () => {
    expect(() => validateAccessoryBlocks([block('A', { note: 'x'.repeat(2_000_001) })])).toThrow('too large');
  });

  it('accepts an empty list, which is how the last block is deleted', () => {
    expect(validateAccessoryBlocks([])).toEqual([]);
  });
});

describe('writeAccessoryConfig', () => {
  it('adds a block without touching anything else', async () => {
    const fs = fakeFs({
      bridge: { name: 'Homebridge' },
      accessories: [{ accessory: 'other', keep: true }],
      platforms: [{ platform: 'mqttthing-ex', devices: [{ name: 'Lamp', type: 'lightbulb' }] }],
      unknownTopLevelKey: { untouched: 1 },
    });

    const result = await writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH);

    const written = configOf(fs);
    expect(written.bridge).toEqual({ name: 'Homebridge' });
    expect(written.platforms).toEqual([{ platform: 'mqttthing-ex', devices: [{ name: 'Lamp', type: 'lightbulb' }] }]);
    expect(written.unknownTopLevelKey).toEqual({ untouched: 1 });
    expect(written.accessories).toEqual([{ accessory: 'other', keep: true }, block('A')]);
    expect(result.hash).toBe(hashOfBlock([block('A')]));
  });

  it('replaces blocks in place, keeping their positions among other plugins', async () => {
    const existing = [{ accessory: 'other', n: 0 }, block('A'), { accessory: 'other', n: 1 }, block('B')];
    const fs = fakeFs({ accessories: existing });

    await writeAccessoryConfig(
      fs.deps,
      CONFIG_PATH,
      [block('A', { url: 'mqtt://new' }), block('B')],
      hashOfBlock([block('A'), block('B')]),
    );

    expect(accessoriesOf(fs)).toEqual([
      { accessory: 'other', n: 0 },
      block('A', { url: 'mqtt://new' }),
      { accessory: 'other', n: 1 },
      block('B'),
    ]);
  });

  it('appends added blocks after the last of ours', async () => {
    const fs = fakeFs({ accessories: [block('A'), { accessory: 'other' }] });

    await writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A'), block('B')], hashOfBlock([block('A')]));

    expect(accessoriesOf(fs)).toEqual([block('A'), block('B'), { accessory: 'other' }]);
  });

  it('removes deleted blocks while leaving other plugins in place', async () => {
    const fs = fakeFs({ accessories: [block('A'), { accessory: 'other' }, block('B'), block('C')] });

    await writeAccessoryConfig(
      fs.deps,
      CONFIG_PATH,
      [block('A')],
      hashOfBlock([block('A'), block('B'), block('C')]),
    );

    expect(accessoriesOf(fs)).toEqual([block('A'), { accessory: 'other' }]);
  });

  it('allows deleting every one of our blocks, which shrinks the file legitimately', async () => {
    const many = Array.from({ length: 200 }, (_, i) => block(`Device ${i}`));
    const fs = fakeFs({ accessories: [...many, { accessory: 'other' }], platforms: [] });

    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [], hashOfBlock(many))).resolves.toBeDefined();
    expect(accessoriesOf(fs)).toEqual([{ accessory: 'other' }]);
  });

  it('creates the accessories array when the configuration has none', async () => {
    const fs = fakeFs({ platforms: [] });
    await writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH);
    expect(configOf(fs).accessories).toEqual([block('A')]);
  });

  it('returns a hash the next read agrees with', async () => {
    const fs = fakeFs({});
    const { hash } = await writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH);
    const read = await readAccessoryConfig(fs.deps.readFile, CONFIG_PATH);
    expect(read.hash).toBe(hash);
  });

  it('refuses when the blocks changed since they were read', async () => {
    const fs = fakeFs({ accessories: [block('A', { url: 'mqtt://disk' })] });
    await expect(
      writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A', { url: 'mqtt://mine' })], hashOfBlock([block('A')])),
    ).rejects.toThrow('changed outside this editor');
    expect(accessoriesOf(fs)).toEqual([block('A', { url: 'mqtt://disk' })]);
  });

  it('refuses when a block appeared while the editor was open', async () => {
    const fs = fakeFs({ accessories: [block('A')] });
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH)).rejects.toThrow(
      'changed outside this editor',
    );
  });

  it('refuses a stale save that would delete blocks it never saw', async () => {
    // the guard is what stops "I read nothing, so write nothing" from
    // emptying a configuration that has since gained blocks
    const fs = fakeFs({ accessories: [block('A'), block('B')] });
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [], null)).rejects.toThrow('changed outside this editor');
    expect(accessoriesOf(fs)).toHaveLength(2);
  });

  it('refuses to write over an unparseable configuration', async () => {
    const fs = fakeFs('{ broken');
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH)).rejects.toThrow(
      'Refusing to touch it',
    );
    expect(fs.files.get(CONFIG_PATH)).toBe('{ broken');
  });

  it('refuses to write while a mistyped platform block is present', async () => {
    const fs = fakeFs({ platforms: [{ platform: 'mqttthing', devices: [{ name: 'Lamp' }] }] });
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH)).rejects.toThrow(
      'is the accessory alias',
    );
    expect(fs.ops).toEqual([]);
  });

  it('refuses when accessories is not an array', async () => {
    const fs = fakeFs({ accessories: { accessory: 'mqttthing' } });
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH)).rejects.toThrow(
      'not an array. Refusing to touch it',
    );
  });

  it('refuses a malformed block before writing anything', async () => {
    const fs = fakeFs({ accessories: [] });
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [{ noName: true }], EMPTY_HASH)).rejects.toThrow(
      'non-empty "name"',
    );
    expect(fs.ops).toEqual([]);
  });

  it('is not fooled by a configuration file with different formatting', async () => {
    // two-space indentation on disk: reserializing grows the file, which must
    // not read as data loss in either direction
    const fs = fakeFs(JSON.stringify({ platforms: [{ platform: 'other' }] }, null, 2));
    await expect(writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH)).resolves.toBeDefined();
  });

  it('keeps a large unrelated configuration intact while emptying ours', async () => {
    const other = Array.from({ length: 200 }, (_, i) => ({ accessory: 'other', name: `A${i}` }));
    const fs = fakeFs({ accessories: [...other, block('A')], platforms: [{ platform: 'first' }] });

    await writeAccessoryConfig(fs.deps, CONFIG_PATH, [], hashOfBlock([block('A')]));

    const written = configOf(fs);
    expect(written.accessories).toEqual(other);
    expect(written.platforms).toEqual([{ platform: 'first' }]);
  });

  it('backs up, writes to a temporary file, preserves the mode and renames', async () => {
    const fs = fakeFs({ accessories: [] });
    fs.modes.set(CONFIG_PATH, 0o600);

    await writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH);

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

    await expect(writeAccessoryConfig(deps as never, CONFIG_PATH, [block('A')], EMPTY_HASH)).rejects.toThrow(
      'disk full',
    );
    expect(fs.ops).toContain(`unlink:${CONFIG_PATH}.tmp-mqttthing`);
    expect(accessoriesOf(fs)).toEqual([]);
  });

  it('writes four-space indented JSON with a trailing newline', async () => {
    const fs = fakeFs({ accessories: [] });
    await writeAccessoryConfig(fs.deps, CONFIG_PATH, [block('A')], EMPTY_HASH);
    const raw = fs.files.get(CONFIG_PATH)!;
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n    "accessories"');
  });
});
