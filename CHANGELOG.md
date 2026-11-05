# Changelog

All notable changes to the **Sovereign Agent** extension will be documented in this file.

## [0.1.27] - 2026-11-05

### Changed
- **Unified Graphify Design System & Palette (`src/agent/graphify.ts`, `media/chat.css`):**
  - Updated the Graphify Knowledge Graph visualizer to use Sovereign Agent's native warm obsidian / terracotta / sage design system (`--bg: #171716`, `--surface: #1f1f1e`, `--accent: #d97757`).
  - Added full light/dark theme support matching VS Code and the in-app theme toggle with adaptive node borders, canvas edges, and text contrast.
  - Aligned header badges, toolbar buttons, and starter chips in the chat interface to match Sovereign Agent's terracotta accent styling.

## [0.1.26] - 2026-11-05

### Fixed
- **Graphify Button Visibility (`src/ui/chatViewProvider.ts`, `media/chat.css`, `package.json`):** Added a high-visibility cyan `Graphify` pill button in the chat header (with flex-wrap so icons never clip on narrow sidebars), a Graphify icon button in the bottom composer toolbar next to `🌐`, a `Graphify` starter chip, and a native `$(type-hierarchy)` button in the VS Code view title bar.

## [0.1.25] - 2026-11-05

### Added
- **Graphify Codebase Knowledge Graph Engine & Interactive Visualizer (`src/agent/graphify.ts`, `code_graph` Tool, `/graphify` Command):**
  - Built-in local deterministic Codebase Knowledge Graph analyzer supporting TypeScript, JavaScript, Python, Go, Rust, Java, C#, C/C++, HTML, CSS, SQL, and Markdown.
  - Extracts module clusters, exported/defined symbols (`function`, `class`, `interface`, `table`), explicit import/dependency edges (`A --> B`), architectural hubs ("god-nodes"), circular dependencies, and codebase health score (`0–100`).
  - Interactive side-by-side **🕸️ Graphify Knowledge Graph** Force-Directed Canvas Panel inside VS Code with zoom/pan, node dragging, cluster color-coding, live search filter, symbol/dependency inspector, 1-click file opening, and 1-click **"🤖 Send Graph to Agent"**.
  - Added `/graphify` chat slash command, `<code_graph>` agent tool (`map`, `query`, `impact`), header shortcut button (`🕸️`), and `+` menu entry.

## [0.1.24] - 2026-11-03

### Fixed
- **Live Preview Flexbox/Grid Isolation & Interactive DevTools Bar (`src/agent/browserPreview.ts`):** Changed `#__sov_bar__` from `position: sticky` to `position: fixed; top: 0; left: 0; right: 0` so it never participates in `body { display: flex; justify-content: center; align-items: center }` layouts, and added interactive **🔍 DOM Inspector Drawer**, **▶ Test UI (1-Click Auto-Tester)**, **↻ Reload**, and **✕ Minimize** controls directly on the preview toolbar.

## [0.1.23] - 2026-11-03

### Added
- **In-Editor Live Web Preview & Automated DOM/UI Tester (`src/agent/browserPreview.ts`, `browser_action` Tool):**
  - Opens workspace `.html` files (with automatic local CSS/JS inlining) or local dev servers (`http://localhost:...`) in a side-by-side VS Code editor preview panel (`🌐 Sovereign Live Preview & Tester`).
  - Allows the agent to inspect rendered DOM & bounding-box layout, click buttons (`<action>click</action><selector>#btn</selector>`), type into inputs (`<action>type</action>`), highlight interacted elements in real time, and capture `console.log` / uncaught JS runtime errors.
  - Added header shortcut button (`🖥️`) and command `Sovereign Agent: 🌐 Open Live Web Preview & Tester` (`sovereignAgent.openPreview`).

## [0.1.22] - 2026-11-03

### Changed
- **Performance & Streaming Optimization (`src/llm/factory.ts`, `src/agent/protocol.ts`, `src/ui/chatViewProvider.ts`, `media/chat.js`, `src/agent/tools.ts`):**
  - Parallelized local LLM server auto-discovery (`discoverLocalServer`) with `AbortController` timeouts, reducing cold discovery latency from up to 9,000ms to <150ms.
  - Pre-compiled tool protocol regexes and added $O(1)$ fast-paths in `parseToolCall` and `visibleText` during token streaming.
  - Added 25ms IPC coalescing in `ChatViewProvider` and `requestAnimationFrame` DOM/scroll batching in `media/chat.js` to eliminate UI stutter at high token/s rates.
  - Enabled live RSS memory reporting (`MB`) in the Performance metrics card.

## [0.1.21] - 2026-11-03

### Added
- **In-App 5-Star Rating & GitHub Star Banner (`src/ui/chatViewProvider.ts`, `media/chat.js`, `media/chat.css`):** Added a gold `★` Star button in the header, an interactive 5-star Marketplace rating & GitHub Star card in the Support panel, a `Sovereign Agent: ⭐ Rate 5 Stars on Marketplace` command, and milestone-based review prompts (at 3, 10, and 25 runs).
- **1-Click `vscode:extension/` Install Links & Marketplace Badges (`package.json`, `README.md`):** Added `vscode:extension/ertugrul37.sovereign-agent` direct VS Code install CTAs, Marketplace sidebar `badges`, `homepage`, `qna`, and expanded model search descriptions (`DeepSeek`, `Qwen`, `Gemma`, `Web Search`, `MCP`).

## [0.1.20] - 2026-11-03

### Fixed
- **Resilient XML Tool Parser for Local Models (`src/agent/protocol.ts`, `src/agent/tools.ts`, `src/agent/prompt.ts`):** Fixed `Missing parameter <content> for write_file.` errors on smaller local models (`gemma-4-e4b`, `llama`, `qwen`, `mistral`) by supporting alternative tag names (`<code>`, `<file_content>`, `<text>`), unclosed `<content>` tags, XML attributes (`<write_file path="...">`), raw or fenced code blocks placed directly inside or right before `<write_file>`, automatic outer code-fence unwrapping, and self-correcting XML template hints on missing parameter errors.

## [0.1.19] - 2026-11-03

### Added
- **Built-in Web Search (`web_search` Tool & `🌐` Composer Toggle):** Added privacy-preserving zero-config Web Search (`src/agent/webSearch.ts`), a quick `🌐` Web Search toggle button in the composer bar and `+` menu, and clickable Web Search result cards in the chat UI.

## [0.1.18] - 2026-11-03

### Fixed
- **Tool Card & Code Block Flex Compression Fix (`media/chat.css`):** Added `flex-shrink: 0` and removed `overflow: hidden` clipping on `.msg`, `details.tool`, `.confirm-card`, and `.code-block` so tool cards and directory listings never get vertically squished when the chat view scrolls.

## [0.1.17] - 2026-11-02

### Changed
- **Modernized Tool Execution Cards & File Chips (`media/chat.js`, `media/chat.css`):** Redesigned `.msg.tool` blocks (`list_files`, `read_file`, `write_file`, `run_command`, `search_files`) with dedicated tool icons, target path badges, live status pills (`•••` / `✓` / `✕`), rotating chevrons, and interactive file/folder chip grids for directory listings.

## [0.1.16] - 2026-11-02

### Added
- **Zero-Config Local Server Auto-Discovery (`discoverLocalServer`):** Automatically probes local loopback ports (`Ollama :11434`, `LM Studio :1234`, `llama.cpp :8080`, `vLLM :8000`, `Jan :1337`, `GPT4All :4891`) and selects the first active local server and model out-of-the-box.
- **Interactive Code Block Toolbar (`Copy` / `Insert` / `▶ Run`):** Added 1-click Copy, Insert into Editor, and Run in Terminal action buttons on every chat code block.
- **GitHub Actions CI & Automated Releases:** Added `.github/workflows/ci.yml` to run all security/unit tests and publish VSIX release artifacts automatically.

## [0.1.15] - 2026-11-02

### Added
- **Marketplace Showcase Preview (`media/showcase.png`):** Added visual product overview banner to the Marketplace README.

## [0.1.14] - 2026-11-02

### Fixed
- **Interactive Agent Terminal & Output Buffering:** Fixed Pseudoterminal startup race condition where early command output was dropped before `pty.open()`; removed the read-only banner and added interactive `stdin` support (`Enter`, `Backspace`, `Ctrl+C`) for running scripts.
- **Automatic Windows Python & UTF-8 Resolution:** Automatically discovers local Windows Python installations (`%LOCALAPPDATA%\Programs\Python\Python*`, `C:\Python*`) and sets `PYTHONIOENCODING=utf-8` / `PYTHONUTF8=1` so `python` commands and non-ASCII output work out-of-the-box.

## [0.1.13] - 2026-11-02

### Added
- **Marketplace SEO & Showcase:** Expanded Marketplace search keywords (30 high-intent terms), categories (`Machine Learning`, `Programming Languages`), localized Marketplace titles/descriptions, and a comprehensive feature comparison showcase in `README.md`.
- **One-Time Review Prompt:** Added a gentle, one-time Marketplace review prompt after 15 completed agent runs.

## [0.1.12] - 2026-11-02

### Added
- **Support & Feedback Panel (`(!)` Header Button):** Added a dedicated Support & Feedback button in the top menu bar and `+` menu where users can write feature requests/feedback and send them directly to `destekai.sovereign.ai@gmail.com` or copy the support email with one click.
- **Expanded World Language Support (16 Languages):** Added full support and UI translations for Turkish (`tr`), English (`en`), German (`de`), Spanish (`es`), French (`fr`), Chinese (`zh`), Russian (`ru`), Japanese (`ja`), Korean (`ko`), Portuguese (`pt`), Italian (`it`), Arabic (`ar`), Dutch (`nl`), Polish (`pl`), Hindi (`hi`), and Azerbaijani (`az`).
- **Quick Language Selector:** Added a Language selector (`🌐`) in the top header bar, inside the `+` menu (`Dil Seçimi / Language`), in VS Code Settings (`sovereignAgent.language`), and via the `Sovereign Agent: Dil Seç / Select Language` command.

### Fixed
- **Host Clipboard Integration & Dynamic i18n:** Routed email clipboard copying through VS Code's native host API and enabled live language switching on active confirmation buttons.

## [0.1.11] - 2026-11-02

### Fixed
- **Approval Buttons Design & i18n:** Fixed missing `approval.*` keys in webview UI causing empty/collapsed confirmation buttons; added clear icons, full labels, and modernized confirmation card styles.

## [0.1.10] - 2026-11-02

### Added
- **Local Network Discovery:** Opt-in UDP presence broadcast and HTTP peer information endpoint (`sovereignAgent.showNetworkPeers` command).
- **Personalized Greeting:** `sovereignAgent.userName` setting for customizable chat greetings.
- **Symlink Traversal Hardening:** Parent directory recursion checks preventing symlink escapes on newly created files.
- **Binary Extension Filter:** Fast skipping of binary files (`.png`, `.exe`, `.dll`, `.zip`, etc.) in `search_files` tool.
- **Expanded IPv6 Support:** Support for IPv4-mapped hex loopbacks (`[::ffff:7f00:1]`) and IPv6 private LANs (`fc00::/7`, `fe80::/10`).
- **Complete i18n Sync:** Full command and configuration translations across English, Turkish, German, Spanish, and French.
- **Automated Agensi Skills:** Added standalone skills in `agensi-skills/` with PowerShell and Bash automation scripts for local AI setup and code reviews.

### Fixed
- Fixed duplicate `ToolContext` instantiation in `handleSend`.
- Fixed missing `LICENSE` file warnings during VSIX packaging.
- Fixed missing localization keys across European locales (`package.nls.de.json`, `package.nls.es.json`, `package.nls.fr.json`).

## [0.1.9] - 2026-10-20

### Added
- Model comparison mode: run prompts side-by-side against two local models.
- Inline approval requests within the webview chat UI.
- Checkpoint restoration and undo command (`sovereignAgent.undo`).

## [0.1.0] - 2026-09-15

### Initial Release
- Fully local AI agent loop with tool-use protocol.
- Local provider integrations: Ollama, LM Studio, llama.cpp, LocalAI, vLLM.
- Approval gates for file writes, replacements, and terminal commands.
- Local STDIO Model Context Protocol (MCP) support.

