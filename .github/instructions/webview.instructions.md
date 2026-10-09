---
name: Sovereign Webview
description: "Use when editing the Sovereign Agent chat webview JavaScript, CSS, HTML, accessibility, or message protocol."
applyTo: ["media/**/*.js", "media/**/*.css", "src/ui/**/*.ts"]
---

- Preserve the strict webview CSP and nonce-based script loading.
- Escape model text before rendering; use `textContent` for tool output and user content.
- Keep keyboard interaction accessible: Enter sends, Shift+Enter creates a newline, and focus remains visible.
- Update the TypeScript message union and webview handler together when adding a message type.
- Use VS Code theme variables instead of hard-coded colors.
