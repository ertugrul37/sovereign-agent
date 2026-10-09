# Sovereign Agent

Free, fully local AI coding agent for VS Code. No cloud, no telemetry.

Sovereign Agent is a chat-based coding agent that reads your workspace, edits files and runs commands, powered only by a model running on your own machine. It is built for people who want the Cline / Kilo Code workflow without sending a single line of code to someone else's server.

## Principles

- **Local only.** The extension refuses to connect to anything that is not `localhost` (or, if you opt in, a private LAN address). This is enforced in code, not just promised.
- **No telemetry.** There is no analytics code and no network call except to your model server.
- **You approve changes.** File writes and shell commands ask for confirmation by default.
- **Works with small models.** Tool calls use a plain XML text protocol, so any chat model works, with or without native function calling.

## Requirements

- VS Code 1.85 or newer
- A local model server:
  - [LM Studio](https://lmstudio.ai) (default): load a model and start the local server (Developer tab, port 1234), or
  - any OpenAI-compatible server: llama.cpp `llama-server`, vLLM, LocalAI, or
  - [Ollama](https://ollama.com): set `sovereignAgent.provider` to `ollama`

## Quick start

### Marketplace installation

Install **Sovereign Agent** from the VS Code Marketplace. Once installed from
the Marketplace, VS Code checks for new published versions and updates the
extension automatically according to the user's normal extension update
settings. No manual `.vsix` download or reinstall is needed.

The `.vsix` file is still useful for local development and testing:

```bash
git clone https://github.com/ertugrul37/sovereign-agent.git
cd sovereign-agent
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host, open the Sovereign Agent icon in the activity bar, pick a model and start chatting.

To build an installable package: `npm run package`, then **Extensions → … → Install from VSIX**.

### Publishing updates

The extension is published under the `ertugrul37` publisher. To release an
update:

1. Increase `version` in `package.json`.
2. Commit the change and create a version tag such as `v0.1.1`.
3. Push the commit and tag. The `publish.yml` workflow runs the tests and
   publishes the new version to the Marketplace.

The repository must have a `VSCE_PAT` GitHub Actions secret containing a
Visual Studio Marketplace publisher token. VS Code users then receive the
published update through the standard Marketplace update mechanism.

## Language support

The interface, approval dialogs, error messages and the extension's settings and commands are translated.

| Code | Language |
| ---- | -------- |
| `en` | English |
| `tr` | Türkçe |
| `de` | Deutsch |
| `es` | Español |
| `fr` | Français |

- **`sovereignAgent.language`** defaults to `auto`, which follows VS Code's display language. Set it to a code above to override.
- The agent **replies in the language you write in**. If that is unclear, it falls back to the selected interface language.
- Tool names, file paths and code are never translated.

### Adding a language

1. Copy `src/i18n/locales/en.ts` to `src/i18n/locales/<code>.ts` and translate the values. TypeScript fails the build if a key is missing.
2. Register it in `src/i18n/index.ts` (`catalogs` and `LOCALE_NAMES`).
3. Copy `package.nls.json` to `package.nls.<code>.json` and translate it (this localizes commands and settings in VS Code).
4. Add the code to the `sovereignAgent.language` enum in `package.json`.

## Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `sovereignAgent.provider` | `openai-compatible` | `openai-compatible` (LM Studio, llama.cpp, vLLM) or `ollama` |
| `sovereignAgent.baseUrl` | *(empty)* | Empty uses `http://localhost:1234/v1` (LM Studio) or `http://localhost:11434` (Ollama) |
| `sovereignAgent.model` | *(empty)* | Model name. Use **Sovereign Agent: Select Model** to pick one |
| `sovereignAgent.language` | `auto` | Interface language |
| `sovereignAgent.temperature` | `0.2` | Sampling temperature |
| `sovereignAgent.contextLength` | `8192` | Context window in tokens |
| `sovereignAgent.maxIterations` | `20` | Max tool steps per message |
| `sovereignAgent.requireWriteApproval` | `true` | Confirm before writing files |
| `sovereignAgent.requireCommandApproval` | `true` | Confirm before running commands |
| `sovereignAgent.allowLanHosts` | `false` | Allow servers on private LAN addresses |

LM Studio works out of the box. For llama.cpp set `sovereignAgent.baseUrl` to `http://localhost:8080/v1`.

## Tools the agent can use

`list_files`, `read_file`, `write_file`, `replace_in_file`, `search_files`, `get_editor_context`, `run_command`. All paths are confined to the open workspace folder, including through symlinks. `replace_in_file` is the preferred surgical edit path and `get_editor_context` exposes the active editor and selection when the user asks about highlighted code.

## Workspace customization

The repository ships with a modern VS Code agent setup:

- `.github/copilot-instructions.md` contains the privacy, architecture, safety, and validation invariants loaded into agent sessions.
- `.github/instructions/` provides focused TypeScript and webview rules.
- `.github/agents/` provides a lead architect and a high-signal reviewer.
- `.github/prompts/modernize-agent.prompt.md` provides a reusable modernization workflow.

The extension automatically loads `.github/copilot-instructions.md` (or root `AGENTS.md`) into the local model's system prompt. Keep project-specific build commands and architectural constraints there.

## Project layout

```
src/
  extension.ts          activation, commands
  config.ts             settings
  localGuard.ts         local-only network check
  agent/
    agent.ts            the agent loop
    protocol.ts         XML tool-call parser
    prompt.ts           system prompt
    tools.ts            workspace tools
  llm/
    ollama.ts           Ollama provider
    openaiCompatible.ts llama.cpp / LM Studio / vLLM provider
    factory.ts          provider creation + local guard
  i18n/                 translations
  ui/chatViewProvider.ts  sidebar chat (webview)
media/                  webview CSS/JS, icon
```

## Development

```bash
npm run watch   # recompile on change
npm test        # compile and run unit tests (Node 22+)
```

## Roadmap

- [x] `replace_in_file` for surgical edits
- [x] Add selected editor code to the chat
- [x] Workspace instructions and custom VS Code agents
- [ ] Diff preview before applying edits
- [ ] Per-workspace instructions file
- [ ] Checkpoints and undo
- [ ] MCP support
- [ ] Persistent chat history

## License

GPL-3.0-or-later is set in `package.json` as a placeholder. Add the matching `LICENSE` file (GitHub: **Add file → Create new file → LICENSE**, then pick a template) or change the field if you choose a different license.
