#!/usr/bin/env bash
# =============================================================================
# Title:        Privacy Code Review Script (Bash)
# Description:  Sends code or git diffs to a local LLM for privacy-first code
#               review. Reviews are ordered by severity: CRITICAL > HIGH >
#               MEDIUM > LOW, covering Security, Correctness, Design, Style.
# Usage:        ./review.sh [--path <file|dir>] [--model <model>] \
#                           [--base-url <url>] [--save]
# Parameters:
#   --path      File or directory to review (default: current directory)
#   --model     Local model name (default: qwen2.5-coder:7b)
#   --base-url  Local Ollama API base URL (default: http://localhost:11434/v1)
#   --save      If set, saves the review report to review-report-<timestamp>.md
# Prerequisites:
#   - Ollama running locally with the target model pulled
#   - curl
#   - Git (optional, for diff mode)
#   - jq (for JSON parsing)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
TARGET_PATH="."
MODEL="qwen2.5-coder:7b"
BASE_URL="http://localhost:11434/v1"
SAVE=false
MAX_CHARS=12000

# ---------------------------------------------------------------------------
# ANSI colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
RESET='\033[0m'

write_step() { echo -e "${CYAN}  >> $1${RESET}"; }
write_good() { echo -e "${GREEN}  ✓  $1${RESET}"; }
write_warn() { echo -e "${YELLOW}  !  $1${RESET}"; }
write_err()  { echo -e "${RED}  ✗  $1${RESET}" >&2; }
write_sep()  { echo -e "${GRAY}$(printf '─%.0s' {1..70})${RESET}"; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --path)     TARGET_PATH="$2"; shift 2 ;;
        --model)    MODEL="$2";       shift 2 ;;
        --base-url) BASE_URL="$2";    shift 2 ;;
        --save)     SAVE=true;        shift   ;;
        -h|--help)
            sed -n '3,14p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) write_err "Unknown argument: $1"; exit 1 ;;
    esac
done

ENDPOINT="${BASE_URL}/chat/completions"

# ---------------------------------------------------------------------------
# Validate URL — must be local only
# ---------------------------------------------------------------------------
assert_local_url() {
    local url="$1"
    local -a allowed=("http://localhost" "http://127.0.0.1" "http://192.168." "http://10." "http://172.")
    for prefix in "${allowed[@]}"; do
        if [[ "$url" == "$prefix"* ]]; then
            return 0
        fi
    done
    write_err "Rejected URL: '$url'"
    write_err "Only local URLs are permitted (localhost, 192.168.x, 10.x, 172.x)."
    write_err "This script must never call external services."
    exit 1
}

# ---------------------------------------------------------------------------
# Check dependencies
# ---------------------------------------------------------------------------
check_deps() {
    local missing=()
    for cmd in curl jq; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        write_err "Missing required tools: ${missing[*]}"
        write_err "Install them and retry."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Truncate string to N chars
# ---------------------------------------------------------------------------
truncate_content() {
    local content="$1"
    local limit="$2"
    local length=${#content}
    if (( length > limit )); then
        write_warn "Content truncated from ${length} to ${limit} characters."
        echo "${content:0:$limit}"$'\n\n'"[... content truncated at ${limit} characters ...]"
    else
        echo "$content"
    fi
}

# ---------------------------------------------------------------------------
# Gather code content
# ---------------------------------------------------------------------------
get_code_content() {
    local target="$1"

    # Single file
    if [[ -f "$target" ]]; then
        write_step "Reading file: $target"
        cat "$target"
        return
    fi

    # Directory
    if [[ -d "$target" ]]; then
        if command -v git &>/dev/null; then
            pushd "$target" >/dev/null
            local diff=""
            # Try staged diff first, then HEAD diff
            diff=$(git diff --staged 2>/dev/null || true)
            if [[ -z "$diff" ]]; then
                diff=$(git diff HEAD 2>/dev/null || true)
            fi
            popd >/dev/null
            if [[ -n "$diff" ]]; then
                write_step "Using git diff for review"
                echo "$diff"
                return
            fi
        fi

        # Fallback: concatenate source files
        write_step "No git diff found. Scanning source files in: $target"
        local extensions=("*.py" "*.js" "*.ts" "*.go" "*.java" "*.cs" "*.rb" "*.sh" "*.php" "*.c" "*.cpp" "*.h" "*.rs" "*.ps1")
        local content=""
        local count=0

        while IFS= read -r -d '' file; do
            # Skip common non-source dirs
            if echo "$file" | grep -qE '/(node_modules|\.git|dist|build|__pycache__)/'; then
                continue
            fi
            local rel="${file#$target/}"
            content+=$'\n\n'"# --- FILE: ${rel} ---"$'\n'
            content+=$(cat "$file" 2>/dev/null || true)
            (( count++ ))
            (( count >= 30 )) && break
        done < <(find "$target" \( $(printf -- '-name "%s" -o ' "${extensions[@]}" | sed 's/ -o $//') \) -print0 2>/dev/null)

        if [[ -z "$content" ]]; then
            write_warn "No source files found in '$target'."
        fi
        echo "$content"
        return
    fi

    write_err "Path not found: '$target'"
    exit 1
}

# ---------------------------------------------------------------------------
# Escape string for JSON
# ---------------------------------------------------------------------------
json_escape() {
    local s="$1"
    # Use jq for safe JSON string encoding
    printf '%s' "$s" | jq -Rs '.'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo -e "${MAGENTA}╔══════════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${MAGENTA}║          Privacy-First Code Review  —  Local LLM Edition            ║${RESET}"
echo -e "${MAGENTA}╚══════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

assert_local_url "$BASE_URL"
check_deps

write_step "Model   : $MODEL"
write_step "Endpoint: $ENDPOINT"
write_step "Target  : $TARGET_PATH"
write_sep

# Resolve absolute path
TARGET_PATH="$(cd "$(dirname "$TARGET_PATH")" 2>/dev/null && pwd)/$(basename "$TARGET_PATH")" || TARGET_PATH="$TARGET_PATH"

SYSTEM_PROMPT='You are a privacy-first code review assistant. Your goal is to identify issues
in the submitted code or diff and report them ordered strictly by severity.

Severity levels (use these exact labels):
  [CRITICAL] - Security vulnerabilities, data leaks, PII exposure, hardcoded secrets
  [HIGH]     - Logic errors, unsafe data handling, missing authentication/authorization
  [MEDIUM]   - Design flaws, poor error handling, unvalidated input
  [LOW]      - Style issues, naming, minor inefficiencies, documentation gaps

Review protocol — evaluate in this order:
  1. SECURITY FIRST  : secrets, injections, insecure storage, data exfiltration risks
  2. CORRECTNESS     : bugs, race conditions, off-by-one, null dereferences
  3. DESIGN          : coupling, separation of concerns, API surface, SOLID violations
  4. STYLE           : naming conventions, formatting, dead code, missing docstrings

Output format for each finding:
  [SEVERITY] <File:Line if known> — <Short title>
  Description: <What the problem is>
  Risk:        <Why it matters>
  Fix:         <Concrete recommendation>

End with a short summary table:
  | Severity | Count |
  |----------|-------|

If no issues are found at a severity level, omit that section.
Be concise and actionable. Do NOT praise the code excessively.'

# Gather content
RAW_CODE="$(get_code_content "$TARGET_PATH")"

if [[ -z "${RAW_CODE// }" ]]; then
    write_err "No content to review. Exiting."
    exit 1
fi

# Truncate if needed
CODE="$(truncate_content "$RAW_CODE" "$MAX_CHARS")"

write_good "Content gathered: ${#CODE} characters"
write_sep

# Build JSON payload safely using jq
SYSTEM_JSON="$(json_escape "$SYSTEM_PROMPT")"
USER_TEXT="Please review the following code:"$'\n\n''```'$'\n'"$CODE"$'\n''```'
USER_JSON="$(json_escape "$USER_TEXT")"

PAYLOAD=$(jq -n \
    --argjson system "$SYSTEM_JSON" \
    --argjson user   "$USER_JSON" \
    --arg     model  "$MODEL" \
    '{
        model: $model,
        stream: false,
        messages: [
            { role: "system", content: $system },
            { role: "user",   content: $user   }
        ]
    }')

# Call the local model
write_step "Sending request to local model..."

HTTP_RESPONSE=$(curl --silent --show-error --fail \
    --max-time 300 \
    --header "Content-Type: application/json" \
    --data "$PAYLOAD" \
    "$ENDPOINT") || {
    write_err "curl request failed. Is Ollama running at $BASE_URL?"
    exit 1
}

# Extract review text
REVIEW_TEXT=$(echo "$HTTP_RESPONSE" | jq -r '.choices[0].message.content' 2>/dev/null) || {
    write_err "Failed to parse API response."
    echo "$HTTP_RESPONSE" >&2
    exit 1
}

write_sep
echo ""
echo -e "${YELLOW}  REVIEW RESULTS${RESET}"
echo ""
echo -e "${WHITE}${REVIEW_TEXT}${RESET}"
echo ""
write_sep

# Save report if requested
if [[ "$SAVE" == true ]]; then
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
    REPORT_FILE="review-report-${TIMESTAMP}.md"
    {
        echo "# Privacy Code Review Report"
        echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')"
        echo "**Model:** $MODEL"
        echo "**Target:** $TARGET_PATH"
        echo ""
        echo "---"
        echo ""
        echo "$REVIEW_TEXT"
    } > "$REPORT_FILE"
    write_good "Report saved: $REPORT_FILE"
fi

write_good "Review complete."
echo ""
