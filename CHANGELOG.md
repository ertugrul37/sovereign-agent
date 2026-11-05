# Changelog

All notable changes to the **Sovereign Agent** extension will be documented in this file.

## [0.1.41] - 2026-11-05

### Enhanced & Visual Fidelity Upgrades
- **🎨 Edge-to-Edge Full-Bleed Dark Canvas for PDF (`src/ui/pdfExport.ts`):**
  - Eliminated the white outer border around PDF pages by enforcing `@page { margin: 0; size: A4 portrait; }` with full-bleed `#141416` background and comfortable interior `16mm 14mm` container padding.
- **🛠️ Native Tool Execution & Result Cards in PDF:**
  - Raw XML tool calls (such as `<list_files>`, `<read_file>`, `<replace_in_file>`, `<run_tests>`) are now automatically intercepted and formatted into elegant, compact tool chips (`🛠️ read_file Makefile`, `🧪 run_tests`), hiding unparsed XML markup.
  - Tool outputs (`[list_files result]`, `[run_tests error]`, etc.) are rendered as styled status blocks (`⚙️ Output` / `✕ Error`) with monospace body and success/failure badges.
- **🔤 Clean Terminal Fences & Windows Character Normalization:**
  - Removed redundant `Source` labels from code blocks; code blocks now show clean language badges or terminal styling.
  - Automatically normalizes Windows console replacement characters (`\uFFFD`), restoring correct Turkish characters (e.g. `bulamıyor`).

## [0.1.40] - 2026-11-05

### Added & Visual PDF Export Engine
- **📕 1:1 Pixel-Perfect Chat PDF Export Engine (`src/ui/pdfExport.ts`, `src/ui/chatViewProvider.ts`, `media/chat.js`):**
  - **Identical Visual Replication ("Ekran Görüntüsü Gibi"):** Exports the entire chat conversation as a true PDF document styled identically to the active chat UI. Features sleek dark theme backgrounds (`#141416`), glowing author badges, user message cards (`#2a2926`), assistant cards (`#1a1a1d`), fenced syntax-highlighted code blocks, clean markdown tables with alternating zebra striping, `.code-filepath` chips, and Unicode mathematical/LaTeX arrows (`→`).
  - **Zero External Dependencies / 100% Local:** Uses native headless Chromium engine (Microsoft Edge / Google Chrome / Chromium) with `--headless --print-to-pdf --run-all-compositor-stages-before-draw` to output vector PDFs with selectable text, high-DPI fonts, and strict `@page` print rules (`print-color-adjust: exact`).
  - **Graceful Portable Fallback:** If a headless browser is not present in standard system directories, automatically produces a standalone self-contained printable HTML document with auto-print scripts and opens it in the browser.
  - **Multiple Access Points:**
    - Top header export menu (`#exportChat`) ➔ `📕 PDF Olarak Kaydet (.pdf)`
    - Plus (`+`) composer action menu ➔ `Sohbeti Dışa Aktar` ➔ `PDF Olarak Kaydet (.pdf)`
    - Slash command: `/export pdf`
    - VS Code Command Palette: `Sovereign Agent: 📕 Export Chat Transcript as PDF (.pdf)` (`sovereignAgent.exportChatPdf`)
  - **Full Multi-Language Localization:** PDF export actions, descriptions, and notification toasts are localized in Turkish (`tr`), English (`en`), German (`de`), Spanish (`es`), and French (`fr`).

## [0.1.39] - 2026-11-05

### Fixed
- **🕸️ Graphify Architecture Studio Canvas Render Loop & Viewport Initialization (`media/chat.js`):**
  - **Resilient Continuous Animation Loop:** Fixed an issue where the embedded Graphify canvas could remain black/blank when navigating to the Graphify tab. `drawEmbeddedGraph` now immediately initializes context and maintains a robust `requestAnimationFrame` loop that persists as long as the Graphify view is active, dynamically re-measuring physical canvas bounds.
  - **Tab Switching & Initial Load Redraw:** Added `startEmbeddedLoop()` and coupled it with `switchViewTab('graphify')`, `initOrUpdateEmbeddedGraph()`, and window resize observers so that the architecture graph is immediately drawn when switching tabs or loading graph data.
  - **Failsafe Viewport Centering:** Upgraded `embedFitToViewport()` with fallback boundaries so star clusters, module hubs, radiating spokes, and file satellite nodes are always centered and auto-fitted without `NaN` or 0-dimension collapses.
  - **Subtle Background Dependency Laser Lines:** When no node is clicked, subtle dependency curves are drawn with low opacity to reveal relationships cleanly; clicking or hovering any circle lights up vibrant glowing neon cyan/green laser beams and connected module hubs.

## [0.1.38] - 2026-11-05

### Added & Export Engine
- **📥 Comprehensive Chat Transcript Export Engine (`src/ui/chatViewProvider.ts` & `media/chat.js`):**
  - **Full Conversation Export:** Export the entire conversation with all user questions/prompts and AI assistant answers, code snippets, architectural tables, and tool outputs.
  - **Multiple Export Destinations & Formats:**
    - 📝 **Save as Markdown (`.md`):** Automatically formats conversation with clean markdown headers (`### 👤 User`, `### 🤖 Sovereign Agent`), fenced code blocks, timestamps, workspace metadata, and prompts file save dialog with default `chat-export-<timestamp>.md` in workspace, then opens the saved file in VS Code.
    - 📄 **Open in New Editor Tab:** Instantly opens an untitled Markdown document in VS Code containing the full formatted transcript for live inspection, editing, or saving.
    - 📋 **Copy to Clipboard:** 1-click copy of the entire markdown transcript to the system clipboard with an instant feedback toast notification.
    - 📦 **Save as JSON (`.json`):** Exports structured metadata (`exportedAt`, `workspace`, `model`, `messages`) for backup, model fine-tuning, or external pipeline ingestion.
  - **Multiple Convenient Access Points:**
    - **Header Download Button:** Dedicated download icon button (`#exportChat`) in the top chat header toolbar.
    - **Plus (`+`) Menu:** `📥 Sohbeti Dışa Aktar / Export Chat` submenu with one-click format selectors.
    - **Slash Command:** Type `/export`, `/export md`, `/export editor`, `/export copy`, or `/export json` directly in the chat composer.
    - **Command Palette:** Registered `Sovereign Agent: 📥 Export Chat Transcript (Markdown / JSON)` (`sovereignAgent.exportChat`) command in VS Code.
  - **Full Multi-Language Localization:** Export labels and notifications are fully localized in Turkish (`tr`), English (`en`), German (`de`), Spanish (`es`), and French (`fr`).


### Major Enhancements & Quality-of-Life Upgrades
- **🌐 Mandatory & Enforced Multi-Language AI Adherence (`src/agent/prompt.ts`):**
  - **Uncompromising Language Directive:** Completely fortified `buildSystemPrompt` with strict, high-priority language constraints. The AI is strictly instructed to ALWAYS formulate all conversational text, explanations, code analysis, and thoughts in the user's selected language (e.g. `tr` Türkçe, `de` Deutsch, `es` Español, `fr` Français, `az` Azərbaycan, `ru` Русский, `zh` 中文, `ja` 日本語).
  - **Native Language Reinforcement:** Appends a native reinforcement paragraph in the target language (e.g. Turkish `KESİN DİL TALİMATI (ZORUNLU): ...`) explicitly forbidding reverting to English even when the prompt contains English code snippets, logs, error traces, or file paths.
  - **Localized Command Injections:** Automated `/graphify`, `/benchmark`, and `/tdd` prompts automatically resolve and format in the active locale.

- **💬 Comprehensive Chat Markdown & Typography Engine (`media/chat.js` & `media/chat.css`):**
  - **Robust Heading Rendering:** `#` through `######` markdown headings are beautifully parsed into styled `<h1>`–`<h6>` elements with border accents and typography.
  - **Responsive Markdown Tables:** Multi-column tables (`| ... |`) with alignment syntax (`:---`, `:---:`, `---:`) are seamlessly parsed into responsive, rounded HTML tables with hover highlights and clean padding.
  - **Vibrant, Clickable File Badges in Plain Text & Code Spans:**
    - Any file path or directory (such as `i18n/index.ts`, `agent/agent.ts`, `bot.go`, `db.go`, `package.json`, `media/chat.js`) is automatically detected—both inside code spans and in plain conversational text—and rendered as a high-visibility, glowing cyan (`#38bdf8`) badge with file/folder icons.
    - Clicking any badge instantly opens the file in VS Code via `{ type: 'openFile', file }`.
  - **Flawless LaTeX & Math Arrow Transformation:**
    - Eradicated raw LaTeX symbols and unrendered dollar signs (`$\leftrightarrow$`, `$\leftarrow$`, `$\rightarrow$`, `$\times$`, `\leq`, etc.).
    - Robust regex parser converts them cleanly into beautiful Unicode arrows and math symbols (`↔`, `←`, `→`, `⇐`, `⇒`, `⇔`, `×`, `÷`, `±`, `≤`, `≥`, `≠`, `≈`, `≡`, `∈`, `∉`, `⊆`, `⊂`, `∑`, `∏`, `√`, `∞`) with zero leftover `$` artifacts.

- **🕸️ Graphify Architecture Studio Layout & Clustering Refactor (`src/agent/graphify.ts` & `media/chat.js`):**
  - **Intelligent Domain Clustering:** Fixed the monolithic 1-cluster issue for workspaces with root-level files (such as `aztu-assistant` or flat projects). Files are automatically partitioned into natural architectural domains: `api` (bot, router, endpoints), `auth` (security, crypto, jwt), `data` (database, models, sql), `frontend` (html, css, js), `core`, `config`, `docs`, and `tests`.
  - **Collision-Free Star Constellation Layout:** Multi-tier orbital rings and a 25-iteration collision relaxation pass (`relaxEmbedCollisions` / `relaxNodeCollisions`) ensure nodes never bunch together or overlap in tight crescent fans.
  - **Well-Spaced 4-Tier Hierarchy Layout:** Replaced single vertical column stacking with a balanced 4-tier architectural hierarchy (UI/Entrypoints ➔ Core Orchestrators ➔ Services & Providers ➔ Types, Configs & Assets) with multi-row staggered column wrapping.
  - **Laser Line Illumination:** Clicking any node illuminates outgoing dependency lines in radiant electric cyan (`#38bdf8`) and incoming lines in emerald green (`#4ade80`) with white core beams and glowing halos.


### Major Architectural Integration
- **🔗 Unified In-Extension Graphify Studio (No Separate Tab):**
  - **Embedded Navigation Bar:** Integrated an elegant segmented navigation bar at the top of Sovereign Agent's panel (`[ 💬 Chat ] [ 🕸️ Graphify ]`), allowing seamless one-click switching between conversation and codebase knowledge graph without ever opening a separate editor tab!
  - **Fully Integrated Canvas & Studio View:** Graphify Studio now lives directly inside Sovereign Agent's panel. Features 60fps hardware-accelerated interactive canvas, responsive scaling, floating layout controls (⭐ Star Constellation, 📦 Block Architecture Diagram, 🏛️ Layered Hierarchy), 1-Hop Focus, Cycles highlight, and multi-language picker.
  - **Embedded Inspector & Health Drawer:** Bottom slide-up drawer shows selected node inspection, live symbol/import counts, `📂 Open File` (opens file in editor while keeping Graphify visible), `🤖 Analyze Impact` (switches back to Chat view and runs impact analysis autonomously), Health & Hubs metrics, and `ARCHITECTURE.md` generation.
  - **Instant Keyboard & Command Access:** Commands, chips, and buttons seamlessly switch to the embedded Graphify view inside the extension.


## [0.1.35] - 2026-11-05

### Added & Localized
- **🌐 Comprehensive Multi-Language (i18n) Support in Graphify Architecture Studio (`src/agent/graphify.ts`):**
  - **Dynamic Language Selector Dropdown:** Integrated a sleek header language picker (`🇹🇷 Türkçe`, `🇬🇧 English`, `🇩🇪 Deutsch`, `🇪🇸 Español`, `🇫🇷 Français`, `🇦🇿 Azərbaycan`, `🇷🇺 Русский`, `🇨🇳 中文`, `🇯🇵 日本語`) allowing instant, real-time UI localization without refreshing or losing canvas zoom or camera focus.
  - **Automatic Locale Synchronization:** Graphify Studio automatically detects and applies Sovereign Agent's configured active language upon launching.
  - **100% Localized Studio Interface:**
    - Stats bar: Files, Edges, Symbols, Health badges.
    - Layout modes: Star Constellation, Block Architecture Diagram, Layered Hierarchy.
    - Filter and view toggles: 1-Hop Focus, Circular Dependency Loops, Zoom in/out/fit.
    - Architecture Health & Hubs tab: Health metrics, God-nodes, Circular loops, Orphan dead-code files.
    - Knowledge Graph Export tab: Markdown export descriptions and actions.
    - Inspector tab: Symbols/exports, incoming dependents, outgoing imports, Open File, and Agent Impact analysis prompts.
    - Interactive canvas tooltips and Send to Agent prompt synthesis.


## [0.1.34] - 2026-11-05

### Enhanced & Fixed
- **🌟 Radiant Laser Dependency Illumination on Node Selection (`src/agent/graphify.ts`):**
  - **Click-to-Illuminate Outgoing Lines:** Clicking on any node instantly illuminates its outgoing dependency paths in electric cyan (`#38bdf8`) with an intense neon aura (`shadowBlur = 18`) and double-pass crisp white laser core (`#ffffff`), along with luminous directional arrowheads.
  - **Connected Target & Source Halos:** Nodes targeted by the outgoing lines receive an electric cyan glowing target ring; incoming sources receive an emerald glowing ring (`#4ade80`).
  - **Smart Node Dimming:** Unrelated nodes and lines gently dim (`opacity: 0.22`) when a node is selected, making active architecture paths stand out with maximum clarity.
  - **Stellar Arm & Branch Glow:** In Star Constellation mode, the branch connecting the selected node to its module star shines with cyan laser light, and the major stellar arm to the central project star radiates in warm gold with a white core beam.
- **🐹 Full Go (`.go`) & Rust (`.rs`) Dependency Graph Parsing (`src/agent/graphify.ts`):**
  - Added native AST regex parsers for Go single `import "..."` and block `import ( ... )`, as well as Rust `use` / `mod` statements.
  - Subpath and module segment resolution matches Go package references and sibling files accurately in multi-file Go workspaces.


## [0.1.33] - 2026-11-05

### Enhanced & Upgraded
- **⚡ 5-Stage Hardware & Model Diagnostic Benchmark Suite (`src/agent/benchmark.ts`):**
  - **Comprehensive 5-Stage Diagnostics:** Upgraded from 3 quick checks to a full benchmark measuring:
    1. Streaming Latency (TTFT in ms) and sustained token generation speed (tok/s).
    2. Strict XML Tool-Calling Adherence (validating tag structure without markdown backtick hallucinations).
    3. Multi-Step Mathematical & Logic Reasoning under strict single-token constraints.
    4. Code Synthesis & AST Syntax Error Correction.
    5. Needle-In-A-Haystack Context Memory Retention Probe.
  - **Visual Benchmark Dashboard:** Displays an overall Grade Badge (`👑 Grade S`, `⚡ Grade A`, `⚖️ Grade B`, `🐢 Grade C`, `⚠️ Grade D`), visual progress meters (`[████████░░]`), estimated VRAM usage, and actionable GPU offload recommendations.
  - **Auto-Tuning & Report Export:** Automatically configures optimal temperature, context window size, and writes a detailed `BENCHMARK.md` report directly into the workspace root.
  - **Glowing Chip Styling (`media/chat.css`):** Amber ambient glow and hover elevation on the `⚡ Benchmark` starter chip.

- **🧪 Autonomous Auto-TDD Engine (`src/agent/tddRunner.ts`, `src/ui/chatViewProvider.ts`):**
  - **Autonomous Self-Healing Loop (`/tdd fix`):** When tests fail, Sovereign Agent automatically parses the failure traces, inspects the broken files, repairs the code using `<replace_file_content>`, and re-runs the tests until the test suite is 100% green!
  - **Autonomous Unit Test Generator (`/tdd gen [file]`):** Inspects the currently active editor file (or specified target module), designs edge-case and boundary unit tests matching the project's native test framework, writes the test file, and runs it to ensure it passes immediately.
  - **Rich TDD Visual Dashboard:** Shows a live pass/fail meter (`[██████████] 100% Green`), test execution duration, and breakdown of failing assertions with clickable file links and stack traces.
  - **Expanded Framework Support & Windows Fix:** Seamless support for Vitest, Jest, Node:test, Mocha, Pytest, Cargo test, Go test, Bun test, with Windows `.cmd` binary compatibility.
  - **Glowing Chip Styling (`media/chat.css`):** Emerald ambient glow on the `🧪 Auto-TDD` starter chip.


### Fixed & Enhanced
- **Graphify Modular Clustering & Anti-Collision Layouts (`src/agent/graphify.ts`):**
  - **Granular Cluster Detection:** Fixed an issue where nested workspaces or wrapper folders caused all files to collapse into a single monolithic cluster (e.g. `sovereign-agent (48)`). Files are now accurately separated into their real architectural modules (`src/agent`, `src/ui`, `src/llm`, `src/tests`, `media`, `root`, etc.).
  - **Multi-Ring Orbital Constellation (`⭐ Yıldız & Kollar`):** Replaced the single-arc 2-ring fan with outward concentric orbital layers (expanding at +65px per ring) and active physical collision relaxation (25 iterations), completely eliminating overlapping nodes and clustered text.
  - **Spacious Block Architecture Diagram (`📦 Blok Diyagramı`):** Removed arbitrary 260px card height limits. Cards now dynamically expand to comfortably enclose all files, use 2-column distribution for large modules (>8 files), render sleek compact file dots with padded labels, and calculate generous vertical spacing between card rows.
  - **Quiet Serene Visual Canvas:** Suppressed background import line clutter; dependency curves now illuminate smoothly only when hovering or clicking a node, or for circular dependency loops, keeping all diagram modes tranquil and instantly legible.


### Added & Fixed
- **Markdown & Chat Presentation Overhaul (`media/chat.js`, `media/chat.css`, `src/ui/chatViewProvider.ts`):**
  - **📊 GFM Markdown Table Rendering:** Automatically converts Markdown tables (`| Col | ... |` + `|:---|:---|`) into clean, responsive HTML tables (`<table class="chat-table">`) with cell alignments, hover rows, headers, and horizontal scroll wrapper.
  - **📑 Markdown Headings (`#` to `######`):** Fully supports `#` headings even with emojis, numbers, and tight line spacing. Formatted with Sovereign typography and signature terracotta accenting for `h3`.
  - **📁 Colored Clickable File Path Badges:** Automatically identifies file and folder paths in inline code (e.g. `i18n/index.ts`, `agent/agent.ts`, `styles.css`) and renders them with vibrant sky-blue/amber badges, file icons (📄 / 📁), and tooltips. Clicking any file badge immediately opens the file in the VS Code editor.
  - **🏹 LaTeX Math & Arrow Normalization:** Seamlessly converts LaTeX math notation and arrows (`$\rightarrow$`, `$\leftarrow$`, `$\leftrightarrow$`, `$\Rightarrow$`, `\leq`, `\geq`, `\times`, etc.) into clean Unicode symbols (`→`, `←`, `↔`, `⇒`, `≤`, `≥`, `×`) without ugly raw `$` or `\` syntax.
  - **📜 Enhanced Lists, Quotes & Math:** Native styling for bullet lists (`<ul>`), numbered lists (`<ol>`), blockquotes (`<blockquote>`), horizontal dividers, and inline math spans.


### Added
- **Graphify Star Constellation Architecture & Clean Block Diagram (`src/agent/graphify.ts`):**
  - **⭐ Star & Constellation Arms (Default View):** Replaced chaotic floating dots with a magnificent, structured solar constellation. The workspace core sits at the center (`⭐ Core Star`) with glowing stellar beams extending to major module stations (`src/agent`, `src/ui`, `media`, etc.). Files branch out along their respective module arms in clean, non-overlapping arcs.
  - **📦 Architecture Block Diagram Mode:** A structured system component diagram that renders modules as organized rectangular cards with file lists and orthogonal inter-module dependency channels.
  - **Streamlined Visual Clutter:** Inter-file import arrows only render on hover/selection in constellation mode, completely eliminating visual spaghetti.

## [0.1.29] - 2026-11-05

### Added
- **Major Graphify Architecture Studio Upgrade (`src/agent/graphify.ts`):**
  - **Multiple Visual Layout Modes:** Added 3 layout engines (`⚡ Cluster Force`, `🏛️ Layered Hierarchy`, `🎯 Radial Hubs`) with smooth animated transitions.
  - **Floating Canvas Controls & Filters:** Added 1-click neighborhood isolation (`🎯 1-Hop Focus`), Circular Dependency highlight filter (`⚠️ Cycles`), orphan/dead-code filter, and zoom/pan viewport toolbar (`+`, `-`, `⛶ Fit View`).
  - **Multi-Tab Sidebar Inspector:** Replaced flat list with 3 organized tabs: `🔍 Inspector` (selected node, symbols, dependencies), `📊 Health & Hubs` (God-nodes, circular loops, dead-code candidates), and `📝 Export`.
  - **Mermaid & Markdown Architecture Report Generator:** Added `exportArchitectureReport` to automatically generate and save `ARCHITECTURE.md` in the workspace root with full metrics and Mermaid flowcharts.
  - **Enhanced Aesthetics:** Directional quadratic curved arrows with destination arrowheads, pulsating circular dependency warnings, God-node halos (`👑`), and interactive hover cards.

## [0.1.28] - 2026-11-05

### Added
- **5 Killer Features for Local AI Pair Programming:**
  1. **🛡️ AST Anti-Hallucination Guard (`src/agent/antiHallucination.ts`):** Automatically validates relative file imports and exported symbols before and during file writes/replacements. Warns the model in real time if it attempts to import non-existent files or fake symbols.
  2. **⏪ Time-Travel Workspace Snapshots (`src/agent/snapshot.ts`):** Git-independent multi-file atomic undo system. Automatically captures pre-mutation snapshots on every turn, allowing instant 1-click restoration to any previous turn.
  3. **🎯 Live Preview Inspect & Click-to-Prompt (`src/agent/browserPreview.ts`):** Added `🎯 Pick & Prompt` (or `Alt+Click`) mode inside the live browser preview. Clicking any element automatically opens the source code file at that exact line and pre-fills the chat composer with element context.
  4. **🧪 Auto-TDD Verification Loop (`src/agent/tddRunner.ts`, `<run_tests>` Tool):** Automatically detects workspace test frameworks (`npm test`, `pytest`, `cargo test`, `go test`), runs tests in a sandbox, and reports pass/fail counts and stack traces for autonomous agent self-healing loops. Trigger via `/tdd` command or chip.
  5. **⚡ Hardware Benchmark & 1-Click Auto-Tuner (`src/agent/benchmark.ts`):** Tests raw token generation speed (tok/s), time-to-first-token (TTFT), protocol XML compliance, and reasoning. Evaluates hardware grade (S/A/B/C/D) and applies optimal temperature & context length with 1 click. Trigger via `/benchmark` command or chip.

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

