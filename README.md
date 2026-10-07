# Agentsims

A local workspace for iOS simulators and Android devices.
Inspect and control your app from the browser, CLI, or a coding agent.

## Install

**macOS — Homebrew**

```sh
curl -fsSLo agentsims.rb https://github.com/Maniktherana/agentsims/releases/latest/download/agentsims.rb
HOMEBREW_DEVELOPER=1 HOMEBREW_FORBID_PACKAGES_FROM_PATHS= brew install --formula ./agentsims.rb
```

**macOS or Linux x64 — curl**

```sh
curl -fsSL https://agentsims.dev/install | bash
export PATH="$HOME/.agentsims/bin:$PATH"
```

**Windows x64 — [PowerShell installation](docs/installation.md#windows)**

[Requirements and installer behavior](docs/installation.md).
The runtime requires no Node.js or npm.

## Start

Start your app on a simulator, emulator, or Android device. Then run:

```sh
agentsims doctor
agentsims start
```

Open the printed URL.

## React Native and Expo

Source mapping is optional. Follow the [Metro setup guide](docs/react-native.md).

## Documentation

- [CLI reference](docs/cli.md)
- [Workspace features](docs/workspace.md)
- [Coding agents and extensions](docs/agents.md)
- [Development](docs/development.md)
- [All documentation](docs/README.md)

## License

[Apache-2.0](LICENSE). Includes code from [EvanBacon/serve-sim](https://github.com/EvanBacon/serve-sim).
