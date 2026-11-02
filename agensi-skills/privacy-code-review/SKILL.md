---
name: privacy-code-review
description: "Perform structured, security-first code reviews and vulnerability audits locally without sending source code or diffs to cloud AI."
argument-hint: "Path to file, directory, or leave empty for staged git diff"
---

# Privacy-First Code Review

> A systematic, security-focused code review workflow for developers who want high-signal reviews without sending their codebase to a cloud AI.

---

## When to activate this skill

Activate when the user says any of:
- "review this code", "review my PR", "check this diff"
- "find security issues", "look for bugs", "audit this"
- "review before I merge", "pre-commit check"
- They paste a diff, file, or function and ask for feedback

---

## What this skill does

Performs a structured, layered code review: security first, then correctness, then design, then style. Each layer has explicit checks so nothing is skipped silently. Produces a concise, actionable report ordered by severity — no filler, no flattery.

---

## Review protocol

### Before you start

Ask (or infer from context):
1. **Language / framework** — review lens differs
2. **What changed** — full file, diff, or specific function?
3. **Context** — is this production code? A library? Internal tooling?
4. **Known constraints** — any performance targets, browser compat, existing tech debt to ignore?

If a diff is provided, review only changed lines plus the surrounding context needed to reason about them. Do not comment on unchanged code unless it directly affects the correctness of the change.

---

## Layer 1 — Security (always run first)

> [!IMPORTANT]
> Report every security finding regardless of severity. Never skip this layer even for "simple" changes.

### 1.1 Injection surfaces

Check every place where external data (user input, file contents, env vars, CLI args, network responses) touches an execution boundary:

| Surface | What to look for |
|---|---|
| SQL / ORM | String concatenation into queries → require parameterised queries |
| Shell / exec | User input in `exec`, `spawn`, `system`, template strings → require array args |
| HTML / DOM | Unescaped data in `innerHTML`, `dangerouslySetInnerHTML`, `document.write` |
| Path construction | `path.join(root, userInput)` without `realpath` + confinement check |
| Eval / dynamic code | `eval()`, `new Function()`, `vm.runInContext()` with external data |
| Regex | User-controlled patterns → ReDoS risk |

**Flag:** Any concatenation of untrusted data into a command, query, template, or path.

---

### 1.2 Authentication and authorisation

- Is an auth check present before every sensitive action?
- Is auth done server-side, not just client-side?
- Are session tokens validated, not just present?
- Is there a privilege-escalation path (e.g. user-controlled role field)?

---

### 1.3 Secrets and sensitive data

- Hardcoded secrets, tokens, passwords, private keys in source → immediate flag
- Secrets logged to console, file, or error messages
- Sensitive data stored in `localStorage`, cookies without `HttpOnly`/`Secure`, or URL params
- Debug/test credentials left in non-test code

---

### 1.4 Cryptography

- `Math.random()` used for security purposes → must be `crypto.randomBytes` / `crypto.randomUUID`
- Weak algorithms: MD5, SHA-1 for integrity, DES, RC4, ECB mode
- Hardcoded IVs or salts
- Timing attacks in comparison (use constant-time compare for secrets)

---

### 1.5 Dependency and supply chain

- New dependencies added? Check:
  - Is the package well-maintained (recent releases, open issues)?
  - Is the import scoped correctly (exact version or caret with lockfile)?
  - Does it pull in transitive deps with known CVEs?
- `eval`-like packages: `serialize-javascript`, `vm2`, `node-serialize` → extra scrutiny

---

### 1.6 Error handling and information leakage

- Stack traces, internal paths, or SQL errors returned to the client
- Catch blocks that swallow errors silently (`catch {}` or `catch (e) {}` with no action)
- Error messages that reveal system info (OS, framework version, internal IDs)

---

## Layer 2 — Correctness

### 2.1 Logic

- Off-by-one errors in loops, slices, pagination
- Incorrect boolean logic (`&&` vs `||`, negation errors)
- Missing edge cases: empty array, zero, null/undefined, very large input
- Incorrect operator precedence

### 2.2 Concurrency and async

- Race conditions: multiple async operations sharing mutable state
- Missing `await` on async calls (silent fire-and-forget)
- Promise rejections not handled (unhandled rejection crash risk)
- `async` function inside `forEach` (does not await — use `for...of` or `Promise.all`)
- Mutex / lock usage: is the critical section correct?

### 2.3 Resource management

- File handles, DB connections, streams opened but not closed (missing `finally` / `using`)
- Memory: large arrays/buffers held longer than needed
- Timer / interval leaks (`setInterval` without `clearInterval` on cleanup)
- Event listener leaks (`addEventListener` without corresponding `removeEventListener`)

### 2.4 Type safety

- `any` cast that hides a real type mismatch
- Non-null assertions (`!`) on values that can plausibly be null
- Implicit `undefined` from optional chaining used in arithmetic or comparison
- Numeric precision: floating-point equality, integer overflow in JavaScript

### 2.5 Error propagation

- Errors caught and re-thrown with context lost
- Partial operations that succeed halfway on failure (no rollback / compensation)
- Functions that return `undefined` on failure when caller expects a value

---

## Layer 3 — Design

> Only flag issues here if they directly affect maintainability or create future correctness risk. Do not nitpick style preferences.

### 3.1 Complexity

- Cyclomatic complexity > 10 in a single function → suggest extract
- Deeply nested callbacks or conditionals (> 3 levels) → suggest early return / flatten
- Functions doing more than one clearly distinct thing

### 3.2 Coupling and cohesion

- Business logic mixed into HTTP handlers / UI components
- Hardcoded URLs, ports, or environment assumptions that should be config
- Circular dependencies introduced

### 3.3 Testability

- Global state mutated → makes tests order-dependent
- Side effects (I/O, randomness, time) that cannot be injected or mocked
- Missing seam for the most important behaviour to be tested

### 3.4 API surface

- Public function signature changed without a migration path
- Breaking change to a serialised format (JSON schema, DB schema, wire protocol)
- Exported symbol renamed without an alias or deprecation notice

---

## Layer 4 — Style and consistency

> Only report items in this layer that have a direct impact on readability or are inconsistent with the surrounding codebase. Skip personal preference.

- Naming: does the name accurately describe what the thing does?
- Dead code left in (commented-out blocks, unused variables, unreachable branches)
- Inconsistent error-handling pattern (some functions throw, some return `Result` — pick one)
- Missing or misleading comments on non-obvious logic
- TODO/FIXME comments introduced without a tracking issue reference

---

## Output format

Structure every review report exactly like this:

```
## Code Review

### Summary
One or two sentences: what the change does and the overall risk level (Low / Medium / High / Critical).

---

### Findings

#### [CRITICAL] Title — file.ts:42
**What:** What is wrong.
**Why it matters:** Concrete impact (e.g. "allows unauthenticated users to delete any record").
**Fix:**
```code
// minimal correct version
```

#### [HIGH] Title — file.ts:88
...

#### [MEDIUM] Title
...

#### [LOW] Title
...

---

### No findings in
- Security layer 1.3 (secrets) — ✓
- Security layer 1.4 (crypto) — ✓
- Correctness layer 2.2 (async) — ✓
(list only layers that were explicitly checked and passed)

---

### Suggested follow-up
Optional: one or two larger improvements worth a separate PR.
```

**Rules for the report:**
- Order by severity: CRITICAL → HIGH → MEDIUM → LOW
- Each finding must have: location (file + line if known), concrete impact, and a minimal fix
- Do not include findings you are not confident about — mark uncertain ones with "(unverified, please check)"
- Do not pad the report with compliments or summaries of what the code does well unless asked

---

## Severity definitions

| Level | Definition |
|---|---|
| **CRITICAL** | Exploitable without authentication, data loss, RCE, credential exposure |
| **HIGH** | Security issue requiring specific conditions, incorrect behaviour in common paths, breaking API change |
| **MEDIUM** | Incorrect behaviour in edge cases, resource leak, significant design issue that creates future risk |
| **LOW** | Style, naming, missing test, minor design note — fix when convenient |

---

## Language-specific checklists

### TypeScript / JavaScript

- [ ] `eval` / `Function()` with external input
- [ ] `innerHTML` with untrusted content
- [ ] `child_process.exec` with template strings
- [ ] `Math.random()` for tokens or IDs
- [ ] Missing `await` on async calls
- [ ] `async` in `forEach`
- [ ] `any` casts hiding real errors
- [ ] Prototype pollution via `Object.assign({}, userInput)` or spread
- [ ] `JSON.parse` without try/catch on external data
- [ ] `path.join` + user input without sandbox check

### Python

- [ ] `subprocess.shell=True` with user input
- [ ] `pickle.loads` on untrusted data
- [ ] `eval` / `exec` with external input
- [ ] SQL f-strings instead of parameterised queries
- [ ] `assert` used for security checks (stripped in optimised mode)
- [ ] Mutable default arguments
- [ ] `open()` without explicit encoding
- [ ] Missing `with` for file/connection resources

### Go

- [ ] `exec.Command` with user-constructed args
- [ ] `fmt.Sprintf` into SQL queries
- [ ] `http.ListenAndServe` binding to `0.0.0.0` when local-only intended
- [ ] Missing error return checks
- [ ] Goroutine leak (goroutine started with no cancellation path)
- [ ] `defer` inside a loop (deferred to function end, not loop iteration)

### Rust

- [ ] `unsafe` block: is it actually necessary? Is the invariant documented?
- [ ] `unwrap()` / `expect()` in production paths
- [ ] `std::process::Command` with user input
- [ ] `from_utf8_unchecked` on untrusted bytes

---

## What this skill does NOT do

- It does not send your code to any external service
- It does not automatically fix code (it proposes fixes for your review)
- It does not replace a human security audit for high-risk systems
- It does not check runtime behaviour — only static analysis from the diff/file provided

