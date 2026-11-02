# Security Policy

**Sovereign Agent** is built from the ground up with a strict **100% local, zero-cloud, zero-telemetry** security architecture.

## Core Security Guarantees

1. **Loopback Network Enforcement (`src/localGuard.ts`):**
   - Outbound HTTP/HTTPS connections are restricted at the code layer to loopback addresses (`127.0.0.1`, `localhost`, `::1`, `[::ffff:7f00:1]`) and, only when explicitly enabled by the user (`sovereignAgent.allowLanHosts`), RFC1918/IPv6 private LAN addresses.
   - Any attempt to connect to a public internet host is immediately blocked before a socket is opened.
2. **Workspace Path Confinement & Symlink Protection (`src/agent/tools.ts`):**
   - Every file tool (`read_file`, `write_file`, `replace_in_file`, `list_files`, `search_files`) resolves both logical paths and parent directory `fs.realpath` symlinks via `safePath()` to guarantee the agent can never read or write outside the open workspace folder.
3. **Explicit User Approval Gates (`confirm-card`):**
   - File writes, surgical replacements, and terminal commands require explicit user confirmation (`Allow / Deny`) by default, backed by 1-click Undo checkpoints.
4. **Strict Webview Content Security Policy (CSP):**
   - The sidebar webview uses per-session cryptographic nonces and blocks all external scripts, frames, and remote resources.

## Supported Versions

| Version | Supported |
| :--- | :---: |
| `0.1.17` (Latest) | ✅ |
| `< 0.1.17` | ❌ Please upgrade via VS Code Marketplace |

## Reporting a Vulnerability

If you discover a security issue (such as a bypass of `localGuard.ts`, `safePath()`, or command approval gates), please report it privately to:

- **Email:** [destekai.sovereign.ai@gmail.com](mailto:destekai.sovereign.ai@gmail.com)

We respond to all security reports within 48 hours.
