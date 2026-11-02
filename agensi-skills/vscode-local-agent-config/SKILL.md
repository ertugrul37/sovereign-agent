---
name: vscode-local-agent-config
description: "Configure VS Code AI coding agents (Sovereign Agent, Continue.dev, Cursor) to connect to local offline LLM endpoints with automated backup."
argument-hint: "Target extension (sovereignAgent, continue, cursor) or local base URL"
---

# Local-First VS Code Agent Setup

> Configure any VS Code AI agent extension (Sovereign Agent, Continue, Copilot Chat, Cursor) to use a local model — zero cloud, full control.

---

## When to activate this skill

Activate when the user:
- Wants to use a local model inside VS Code
- Asks how to connect Continue, Copilot Chat, or Cursor to Ollama / LM Studio / llama.cpp
- Wants to set up Sovereign Agent for the first time
- Has a local server running but the VS Code extension can't find the model

---

## Assumptions

- A local model server is already running (see the **Local AI Dev Setup** skill if not)
- VS Code 1.85 or newer is installed

---

## Option A — Sovereign Agent (recommended for local-only purists)

**Why:** Built from the ground up to be local-only. Enforces `localhost` / private LAN for every network call. No telemetry. Approval gates before any file write or command.

### Install

1. Open VS Code → Extensions (`Ctrl+Shift+X`)
2. Search **Sovereign Agent** by `ertugrul37`
3. Install → Reload

### Configure

Open Settings (`Ctrl+,`) → search `sovereignAgent`:

| Setting | Value | Notes |
|---|---|---|
| `sovereignAgent.provider` | `ollama` / `lm-studio` / `llama-cpp` / `openai-compatible` | Match your server |
| `sovereignAgent.baseUrl` | `http://localhost:11434` | Your server's endpoint |
| `sovereignAgent.model` | leave blank | Use the model picker instead |
| `sovereignAgent.temperature` | `0.2` | Low = more deterministic for code |
| `sovereignAgent.contextLength` | `8192` | Match your model's context window |
| `sovereignAgent.maxIterations` | `20` | Max agentic steps per turn |
| `sovereignAgent.requireWriteApproval` | `true` | Recommended: always approve file writes |
| `sovereignAgent.requireCommandApproval` | `true` | Recommended: always approve shell commands |

### Pick a model

Click the server icon ($(server)) in the Sovereign Agent sidebar → select from the list fetched from your local server.

### Verify

Ask in the chat: `List the files in this workspace` — the agent should call `list_files` and return your project tree without any network request leaving your machine.

---

## Option B — Continue.dev

```jsonc
// ~/.continue/config.json
{
  "models": [
    {
      "title": "Local Qwen2.5-Coder (Ollama)",
      "provider": "ollama",
      "model": "qwen2.5-coder:7b",
      "apiBase": "http://localhost:11434"
    },
    {
      "title": "Local DeepSeek (LM Studio)",
      "provider": "openai",
      "model": "deepseek-coder-v2",
      "apiBase": "http://localhost:1234/v1",
      "apiKey": "local"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Local autocomplete",
    "provider": "ollama",
    "model": "qwen2.5-coder:1.5b"   // use a small fast model for autocomplete
  }
}
```

---

## Option C — Cursor (custom OpenAI endpoint)

1. `Ctrl+Shift+J` → Models → Add Model
2. Model name: exact name from `GET /v1/models` on your server
3. API Base URL: your server endpoint (e.g. `http://localhost:1234/v1`)
4. API Key: `local` (required field, value ignored by local servers)

> **Note:** Cursor's core features (Cmd+K inline edit, chat) will use your local model. Background indexing and some Cursor-specific features still use Cursor's cloud — this cannot be disabled in Cursor.

---

## Option D — GitHub Copilot Chat with a local proxy

Copilot Chat's API is not configurable, but you can route it through a local proxy that intercepts and redirects to your model:

```bash
# Using LiteLLM as a local proxy
pip install litellm
litellm --model ollama/qwen2.5-coder:7b --port 4000
```

Then set `OPENAI_API_BASE=http://localhost:4000` in your environment. This is a workaround and not officially supported.

---

## Workspace instructions file

Create `.github/copilot-instructions.md` (works with Copilot, Cursor, and Sovereign Agent) to give the agent permanent project context:

```markdown
# Project instructions

- Language: TypeScript, Node.js 20
- All file paths use POSIX separators in model-facing output
- Never introduce `any` types
- Prefer `replace_in_file` for surgical edits, `write_file` only for new files
- Run `npm test` to validate TypeScript and protocol changes
- All network requests must go to localhost or private LAN only
```

---

## Agentic mode checklist

Before running an AI agent on your codebase in file-editing mode:

- [ ] A recent git commit exists (or `git stash`) — you can roll back
- [ ] Approval gates are **on** (`requireWriteApproval`, `requireCommandApproval`)
- [ ] You know how to stop the agent (`$(debug-stop)` button or `Escape`)
- [ ] The model you selected has enough context for your task (check `contextLength`)
- [ ] Sensitive files (`.env`, credentials) are in `.gitignore` and ideally excluded from the workspace

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No models found" | Server not running or wrong URL | Verify with `curl BASE_URL/v1/models` |
| Model list loads but chat fails | Model name mismatch | Copy exact name from `curl` output |
| "URL is not local" error | Extension blocked the URL | Check `baseUrl` — must be `localhost` or LAN |
| Slow first response | Model loading cold | Wait 10–30 s; subsequent responses are faster |
| Agent loops forever | `maxIterations` too high or model not following protocol | Lower `maxIterations`; switch to a larger/better model |
| Diff preview doesn't open | VS Code diff editor disabled | Check Settings → `diffEditor.enabled` |

