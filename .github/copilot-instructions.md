# Sovereign Agent Workspace Guidelines

## Mission

Sovereign Agent is a privacy-first VS Code extension for local coding models. Preserve the local-only network boundary, explicit user approvals, and the ability to run with small models.

## Architecture

- Keep VS Code lifecycle and commands in `src/extension.ts`.
- Keep orchestration and conversation state in `src/agent/`.
- Keep provider-specific HTTP behavior in `src/llm/`.
- Keep workspace boundary, approval, output limits, and tool behavior in `src/agent/tools.ts`.
- Keep user-facing translations in every locale under `src/i18n/locales/`; `MessageKey` makes missing keys a compile error.
- Treat the webview as untrusted UI: keep the CSP strict, use DOM text APIs for untrusted content, and never inject model output as executable HTML.

## Change Rules

- Read a file before editing it; prefer `replace_in_file` for focused changes.
- Never add a network endpoint that bypasses `checkLocalUrl`.
- Never broaden workspace paths beyond the opened workspace or follow symlinks outside it.
- Preserve approval prompts for writes, replacements, and commands unless the user explicitly changes the setting.
- Add or update focused Node tests for protocol, path safety, and tool behavior.
- Keep model-facing tool output deterministic and in English; translate only UI and approval text.

## Validation

Run `npm test` after TypeScript or protocol changes. Run `npm run package` when contribution points or packaging metadata change. Do not hide errors with broad catches or success-shaped fallbacks.
