// Generates config.schema.json from the declarative accessory-type model
// (dist/model/schema.js - run `npm run build` first) and enables the custom
// UI. The generated schema is the config-ui-x fallback form; the custom UI
// in homebridge-ui/ supersedes it.
//
// Usage: node scripts/generate-schema.mjs
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Final config.schema.json document: the generated fallback schema plus the
 * custom UI switches. Exported for unit tests.
 *
 * @param {Record<string, unknown>} base output of generateConfigSchema()
 */
export function buildSchemaDocument(base) {
  return {
    pluginAlias: base.pluginAlias,
    pluginType: base.pluginType,
    singular: base.singular,
    customUi: true,
    customUiPath: './homebridge-ui',
    schema: base.schema,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const { generateConfigSchema } = await import('../dist/model/schema.js');
  const target = fileURLToPath(new URL('../config.schema.json', import.meta.url));
  const document = buildSchemaDocument(generateConfigSchema());
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`wrote ${target}`);
}
