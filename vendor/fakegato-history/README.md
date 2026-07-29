# Vendored fakegato-history

This directory contains [fakegato-history](https://github.com/simont77/fakegato-history)
0.6.7 by simont77 and contributors, MIT licensed (see [LICENSE](LICENSE)).

It is vendored instead of installed from npm for one reason: the npm package
hard-depends on `googleapis` for its optional Google Drive storage backend,
which this plugin never uses (history is always stored on the filesystem under
the Homebridge storage directory). That dependency pulls in an old `googleapis`
release whose transitive tree carries several known-vulnerable packages
(`gaxios`, `googleapis-common`, `rimraf`, `glob`, `minimatch`,
`brace-expansion`), none of which are reachable at runtime — but which npm
`overrides` cannot fix from inside a published dependency.

## Changes relative to upstream 0.6.7

- `fakegato-storage.js`: removed the `googleDrive` require and the
  `case 'googleDrive':` branches from `addWriter`/`write`/`read`/`remove`.
  This plugin only ever passes `storage: 'fs'`.
- `lib/googleDrive.js` and `quickstartGoogleDrive.js` are not included.
- Added `package.json` with `"type": "commonjs"` so Node treats these files
  as CommonJS inside this ESM package.

`fakegato-history.js`, `fakegato-timer.js` and `lib/uuid.js` are byte-for-byte
identical to the upstream 0.6.7 release and can be verified with a plain
`diff` against it.
