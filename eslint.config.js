import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', '.upstream-ref/', 'codecs/', 'node_modules/', 'homebridge-ui/public/', 'test/fixtures/upstream/'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // plain-JS Node files (custom UI server shell + build scripts)
    files: ['homebridge-ui/**/*.js', 'homebridge-ui/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
