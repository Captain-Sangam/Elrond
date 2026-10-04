# Contributing to Elrond

Bug reports, documentation fixes, and code contributions are welcome. For issues, include your macOS version, steps to reproduce, expected and actual behavior, and relevant console output. Follow the [code of conduct](docs/CODE_OF_CONDUCT.md); report vulnerabilities through the [security policy](docs/SECURITY.md).

## Setup

Use macOS 13+ and Node.js 22.12+ (or 20.19+ on the 20.x line):

```bash
git clone https://github.com/Captain-Sangam/Elrond.git elrond
cd elrond
make install
make dev
```

See the [README](README.md#setup-and-install) for provider configuration.

## Verify and submit

1. Create a branch from `main` and keep your change focused.
2. For code changes, run `make test` (typechecking, unit tests, and production build). Add tests for changed behavior and check the app manually when relevant. See [development](docs/development.md) for native dependency notes.
3. For documentation changes, check commands, relative links, and image paths.
4. Open a pull request describing the change, its purpose, and verification. Include screenshots for UI changes.

The [contributor reference](docs/CONTRIBUTING.md) covers code conventions and adding providers, GitHub tools, and MCP presets. The [architecture](docs/architecture.md) explains how the app fits together.

Contributions are licensed under the [MIT License](LICENSE).
