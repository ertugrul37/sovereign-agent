---
name: Modernize Sovereign Agent
description: "Modernize this local VS Code coding agent with a complete vertical slice while preserving privacy, approvals, workspace safety, and small-model compatibility."
argument-hint: "Capability or product area to modernize"
---

Modernize the requested area: ${input:area:capability or product area}.

Before editing:
1. Inspect the relevant extension contribution points, agent protocol, tool context, provider, UI, translations, and tests.
2. State the user-visible behavior and safety invariants.

Implement:
- a complete, typed vertical slice;
- focused tests for success, denial, cancellation, malformed input, and boundary cases where relevant;
- matching translations and contribution metadata;
- concise documentation in the workspace instructions when the invariant is project-wide.

Validate with the smallest relevant test command, then `npm test` if TypeScript or protocol code changed.
