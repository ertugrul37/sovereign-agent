# =============================================================================
# Title:        Privacy Code Review Script (PowerShell)
# Description:  Sends code or git diffs to a local LLM for privacy-first code
#               review. Reviews are ordered by severity: CRITICAL > HIGH >
#               MEDIUM > LOW, covering Security, Correctness, Design, Style.
# Usage:        .\review.ps1 [-Path <file|dir>] [-Model <model>] [-BaseUrl <url>] [-Save]
# Parameters:
#   -Path       File or directory to review (default: current directory)
#   -Model      Local model name (default: qwen2.5-coder:7b)
#   -BaseUrl    Local Ollama API base URL (default: http://localhost:11434/v1)
#   -Save       If set, saves the review report to review-report-<timestamp>.md
# Prerequisites:
#   - Ollama running locally with the target model pulled
#   - PowerShell 5.1+ or PowerShell Core 7+
#   - Git (optional, for diff mode)
# =============================================================================

param(
    [string]$Path    = ".",
    [string]$Model   = "qwen2.5-coder:7b",
    [string]$BaseUrl = "http://localhost:11434/v1",
    [switch]$Save
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$MAX_CHARS   = 12000
$ENDPOINT    = "$BaseUrl/chat/completions"

$SYSTEM_PROMPT = @"
You are a privacy-first code review assistant. Your goal is to identify issues
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
  ...

If no issues are found at a severity level, omit that section.
Be concise and actionable. Do NOT praise the code excessively.
"@

# ---------------------------------------------------------------------------
# Helper: Colored output
# ---------------------------------------------------------------------------
function Write-Step  { param([string]$Msg) Write-Host "  >> $Msg" -ForegroundColor Cyan }
function Write-Good  { param([string]$Msg) Write-Host "  ✓  $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "  !  $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "  ✗  $Msg" -ForegroundColor Red }
function Write-Sep   { Write-Host ("─" * 70) -ForegroundColor DarkGray }

# ---------------------------------------------------------------------------
# Validate URL — must be local only
# ---------------------------------------------------------------------------
function Assert-LocalUrl {
    param([string]$Url)
    $allowed = @("http://localhost", "http://127.0.0.1", "http://192.168.", "http://10.", "http://172.")
    foreach ($prefix in $allowed) {
        if ($Url.StartsWith($prefix)) { return }
    }
    Write-Err "Rejected URL: '$Url'"
    Write-Err "Only local URLs are permitted (localhost, 192.168.x, 10.x, 172.x)."
    Write-Err "This script must never call external services."
    exit 1
}

# ---------------------------------------------------------------------------
# Gather code content
# ---------------------------------------------------------------------------
function Get-CodeContent {
    param([string]$TargetPath)

    # Single file
    if (Test-Path $TargetPath -PathType Leaf) {
        Write-Step "Reading file: $TargetPath"
        return Get-Content -Path $TargetPath -Raw -Encoding UTF8
    }

    # Directory — try git diff first
    if (Test-Path $TargetPath -PathType Container) {
        $gitExists = Get-Command git -ErrorAction SilentlyContinue
        if ($gitExists) {
            Push-Location $TargetPath
            try {
                # Try staged diff first, then HEAD diff
                $diff = & git diff --staged 2>$null
                if ([string]::IsNullOrWhiteSpace($diff)) {
                    $diff = & git diff HEAD 2>$null
                }
                if (-not [string]::IsNullOrWhiteSpace($diff)) {
                    Write-Step "Using git diff for review"
                    return $diff
                }
            } finally {
                Pop-Location
            }
        }

        # Fallback: concatenate source files
        Write-Step "No git diff found. Scanning source files in: $TargetPath"
        $extensions = @("*.ps1","*.py","*.js","*.ts","*.go","*.java","*.cs","*.rb","*.sh","*.php","*.c","*.cpp","*.h","*.rs")
        $files = Get-ChildItem -Path $TargetPath -Recurse -Include $extensions -File |
                 Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|build|__pycache__)\\' } |
                 Select-Object -First 30

        if ($files.Count -eq 0) {
            Write-Warn "No source files found in '$TargetPath'."
            return ""
        }

        $content = ""
        foreach ($f in $files) {
            $rel = $f.FullName.Replace($TargetPath, "").TrimStart("\")
            $content += "`n`n# --- FILE: $rel ---`n"
            $content += (Get-Content -Path $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
        }
        return $content
    }

    Write-Err "Path not found: '$TargetPath'"
    exit 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║          Privacy-First Code Review  —  Local LLM Edition            ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# Validate URL before anything else
Assert-LocalUrl -Url $BaseUrl

Write-Step "Model   : $Model"
Write-Step "Endpoint: $ENDPOINT"
Write-Step "Target  : $Path"
Write-Sep

# Gather content
$code = Get-CodeContent -TargetPath (Resolve-Path $Path).Path

if ([string]::IsNullOrWhiteSpace($code)) {
    Write-Err "No content to review. Exiting."
    exit 1
}

# Truncate if needed
if ($code.Length -gt $MAX_CHARS) {
    Write-Warn "Content truncated from $($code.Length) to $MAX_CHARS characters."
    $code = $code.Substring(0, $MAX_CHARS) + "`n`n[... content truncated at $MAX_CHARS characters ...]"
}

Write-Good "Content gathered: $($code.Length) characters"
Write-Sep

# Build request payload
$messages = @(
    @{ role = "system"; content = $SYSTEM_PROMPT },
    @{ role = "user";   content = "Please review the following code:`n`n``````\n$code\n``````" }
)

$body = @{
    model    = $Model
    messages = $messages
    stream   = $false
} | ConvertTo-Json -Depth 10 -Compress

# Call the local model
Write-Step "Sending request to local model..."
try {
    $response = Invoke-RestMethod `
        -Uri         $ENDPOINT `
        -Method      POST `
        -ContentType "application/json" `
        -Body        $body `
        -TimeoutSec  300
} catch {
    Write-Err "API request failed: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        Write-Err "Server response: $($reader.ReadToEnd())"
    }
    exit 1
}

# Extract review text
$reviewText = $response.choices[0].message.content

Write-Sep
Write-Host ""
Write-Host "  REVIEW RESULTS" -ForegroundColor Yellow
Write-Host ""
Write-Host $reviewText -ForegroundColor White
Write-Host ""
Write-Sep

# Save report if requested
if ($Save) {
    $timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
    $reportFile = "review-report-$timestamp.md"
    $reportContent = @"
# Privacy Code Review Report
**Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Model:** $Model
**Target:** $Path

---

$reviewText
"@
    Set-Content -Path $reportFile -Value $reportContent -Encoding UTF8
    Write-Good "Report saved: $reportFile"
}

Write-Good "Review complete."
Write-Host ""
