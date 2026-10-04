# Packaging and installation

Elrond is a macOS desktop app. Install the source dependencies as described in the [README](../README.md#setup-and-install), then quit any running Elrond instance before packaging or replacing the installed app.

```bash
make export
```

This target:

1. Builds production bundles into `out/` with `npm run build`.
2. Forces `better-sqlite3` to rebuild for Electron with `npx electron-rebuild -f -w better-sqlite3`.
3. Packages a directory build using `npx electron-builder --dir` and `electron-builder.yml`.
4. Finds `Elrond.app` under `dist/` and replaces the installed copy in `/Applications`, falling back to `~/Applications` if `/Applications` is not writable.

The build uses `build/icon.icns`. No signing certificates are required: the configuration has `identity: null`, and electron-builder ad-hoc signs on Apple Silicon so the app launches. These are local builds, without Developer ID signing or notarization.

Launch the installed app from Spotlight. Re-run `make export` after changes to update the installed copy. Quit the running app first so you launch the new build.

## Native dependencies and troubleshooting

Packaging while `better-sqlite3` is built for plain Node can produce an app that launches with no window. `make export` forces the Electron rebuild before packaging. For manual rebuilds and the reason `-f` is required, see [development testing notes](development.md#testing).

Run a packaged app with `ELECTRON_ENABLE_LOGGING=1` to see startup errors. Application data and credentials are described in [architecture](architecture.md#data-storage) and the [privacy guide](user-guide.md#privacy-and-storage).
