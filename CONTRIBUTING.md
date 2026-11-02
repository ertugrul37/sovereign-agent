# Contributing to Sovereign Agent

Thank you for your interest in contributing to **Sovereign Agent**!

## Core Philosophy

Sovereign Agent is a **100% local, offline-first AI coding assistant**. Every contribution must uphold these rules:
1. **Never add cloud endpoints, remote APIs, or telemetry.** All network requests must go through `checkLocalUrl()` (`src/localGuard.ts`).
2. **Never bypass workspace confinement.** All file tools must validate paths through `safePath()` (`src/agent/tools.ts`).
3. **Maintain 16-language localization parity.** Whenever adding a `ui.*` or `approval.*` string to `src/i18n/locales/en.ts`, ensure `npm test` passes across all locales.

## Development Setup

```bash
git clone https://github.com/ertugrul37/sovereign-agent.git
cd sovereign-agent
npm install
npm test
```

- Press **`F5`** in VS Code to launch an Extension Development Host with Sovereign Agent loaded.
- Package a `.vsix` archive locally:
  ```bash
  npx @vscode/vsce package --no-git-tag-version
  ```

## Contact

For questions or feature discussions, open a GitHub Issue or email **[destekai.sovereign.ai@gmail.com](mailto:destekai.sovereign.ai@gmail.com)**.

