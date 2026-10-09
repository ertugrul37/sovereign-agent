---
name: Sovereign TypeScript
description: "Use when editing TypeScript extension, agent, tool, provider, protocol, or test code."
applyTo: "src/**/*.ts"
---

- Use strict, explicit types and existing interfaces; do not introduce `any`.
- Keep filesystem paths platform-safe internally and normalize only model-facing paths to POSIX.
- Propagate `AbortSignal` through network and command operations.
- Return explicit `ToolResult` failures with actionable messages.
- Add a focused `node:test` case when changing parsing, path validation, approvals, or provider behavior.
- Keep changes within the existing module boundary instead of adding duplicated helpers.
