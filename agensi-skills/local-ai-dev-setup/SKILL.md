---
name: local-ai-dev-setup
description: "Install, configure, and verify a fully local AI development stack (Ollama, LM Studio, llama.cpp, Jan) with zero cloud dependencies and no telemetry."
argument-hint: "Provider name (ollama, lm-studio, llama-cpp) or target model"
---

# Local AI Dev Setup

> Install, configure and verify a fully local AI development stack — no cloud account, no API key, no telemetry.

---

## When to activate this skill

Activate when the user says any of:
- "set up a local AI", "run a local model", "offline AI coding"
- "Ollama setup", "LM Studio setup", "llama.cpp", "Jan", "GPT4All", "vLLM", "LocalAI"
- "I don't want my code sent to the cloud", "privacy first AI"
- They want an OpenAI-compatible local endpoint for their editor or tool

---

## What this skill does

Guides the user through picking a local model server, choosing an appropriate model, testing the endpoint, and wiring it into their editor or agent. Every step stays on `localhost` or a private LAN. No cloud call is ever made during setup.

---

## Step 0 — Assess the machine

Before recommending a provider or model, ask (or infer from context):

| Question | Why it matters |
|---|---|
| OS? (Windows / macOS / Linux) | Install commands differ |
| GPU? (NVIDIA / AMD / Apple Silicon / CPU-only) | Determines backend and quantisation tier |
| RAM available? | Floor for model size |
| Disk free? | Models are 2–30 GB each |

Summarise findings like:

```
Detected: Windows 11, NVIDIA RTX 3060 (12 GB VRAM), 32 GB RAM, 80 GB free
Recommended tier: 7–13B models at Q4_K_M quantisation
```

---

## Step 1 — Choose and install a local model server

Present the options below and let the user pick one. Default recommendation: **Ollama** (easiest cross-platform experience).

### Option A — Ollama (recommended)

**Install:**
```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download the installer from https://ollama.com/download
```

**Start the server:**
```bash
ollama serve
# Listens on http://localhost:11434 by default
```

**Pull a model:**
```bash
ollama pull qwen2.5-coder:7b      # Good for coding, 4.7 GB
ollama pull deepseek-coder-v2:16b # Stronger, 9.1 GB (needs ≥12 GB VRAM)
ollama pull llama3.1:8b           # General purpose
ollama pull phi4:14b              # Microsoft, strong for its size
```

**Verify:**
```bash
curl http://localhost:11434/api/tags
# Should return JSON with your model list
```

---

### Option B — LM Studio

1. Download from https://lmstudio.ai
2. Open → "Discover" tab → search for a model → Download
3. "Local Server" tab → Start Server
4. Default endpoint: `http://localhost:1234/v1`

**Verify:**
```bash
curl http://localhost:1234/v1/models
```

---

### Option C — llama.cpp / llama-server

Best for: maximum control, custom quantisation, or running on unusual hardware.

```bash
# Build from source (requires cmake, gcc/clang)
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build -DGGML_CUDA=ON   # omit DGGML_CUDA on CPU-only
cmake --build build --config Release -j$(nproc)

# Download a GGUF model (example: Qwen2.5-Coder-7B-Q4_K_M)
# from https://huggingface.co/Qwen or https://huggingface.co/bartowski

# Run server
./build/bin/llama-server \
  --model ./models/qwen2.5-coder-7b-q4_k_m.gguf \
  --ctx-size 8192 \
  --n-gpu-layers 35 \
  --port 8080

# Endpoint: http://localhost:8080/v1
```

---

### Option D — Jan

Desktop app with a built-in model hub, one-click downloads.

1. Download from https://jan.ai
2. Hub → Download a model → Settings → Local API Server → Enable
3. Endpoint: `http://localhost:1337/v1`

---

### Option E — LocalAI / vLLM / GPT4All

| Server | Endpoint | Best for |
|---|---|---|
| LocalAI | `http://localhost:8080/v1` | Docker-based, many model formats |
| vLLM | `http://localhost:8000/v1` | Multi-GPU, production throughput |
| GPT4All | `http://localhost:4891/v1` | Pure CPU, consumer hardware |

---

## Step 2 — Pick the right model

### Coding tasks

| Model | Size | VRAM needed | Strength |
|---|---|---|---|
| `qwen2.5-coder:7b` | 4.7 GB | 6 GB | Fast, accurate, multilingual code |
| `qwen2.5-coder:14b` | 9 GB | 10 GB | Best mid-range coder |
| `deepseek-coder-v2:16b` | 9.1 GB | 12 GB | Strong reasoning + code |
| `codestral:22b` | 12 GB | 16 GB | Mistral's dedicated coder |
| `phi4:14b` | 8 GB | 10 GB | Punches above its weight |

### General / chat tasks

| Model | Size | Notes |
|---|---|---|
| `llama3.1:8b` | 4.7 GB | Meta, solid baseline |
| `mistral:7b` | 4.1 GB | Fast, instruction-tuned |
| `gemma3:12b` | 7.7 GB | Google, good for multilingual |

### Quantisation guide

| Suffix | Quality | Size |
|---|---|---|
| `Q8_0` | Near-lossless | Largest |
| `Q4_K_M` | ✅ Recommended sweet spot | ~60% of Q8 |
| `Q3_K_M` | Acceptable for weak hardware | ~45% of Q8 |
| `Q2_K` | Noticeable quality loss | Smallest |

---

## Step 3 — Verify the endpoint

Run this universal smoke test regardless of which server you chose. Replace `BASE_URL` and `MODEL`:

```bash
curl http://BASE_URL/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_NAME",
    "messages": [{"role":"user","content":"Reply with only the word PONG"}],
    "max_tokens": 10,
    "stream": false
  }'
```

**Expected:** HTTP 200 with `"content": "PONG"` (or similar one-word reply).

**Common failures:**

| Error | Cause | Fix |
|---|---|---|
| `Connection refused` | Server not running | Start it first |
| `404 /v1/chat/completions` | Wrong endpoint path | Check provider docs |
| `model not found` | Wrong model name | Run `ollama list` or check UI |
| Very slow / OOM | Model too large | Use a smaller model or lower `--n-gpu-layers` |

---

## Step 4 — Wire into your editor or agent

### VS Code — Sovereign Agent extension

1. Install **Sovereign Agent** from the VS Code Marketplace
2. Open Settings → search `sovereignAgent`
3. Set:
   - `provider`: match your server (`ollama`, `lm-studio`, `llama-cpp`, etc.)
   - `baseUrl`: the endpoint from Step 1 (e.g. `http://localhost:11434`)
4. Click the model picker icon in the sidebar → select your model
5. Done — all traffic stays on your machine

### VS Code — Continue.dev

```json
// ~/.continue/config.json
{
  "models": [{
    "title": "Local Qwen2.5-Coder",
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "apiBase": "http://localhost:11434"
  }]
}
```

### Cursor / Windsurf — Custom OpenAI endpoint

Settings → Models → Add Model → Custom:
- API Base: `http://localhost:1234/v1`
- API Key: `local` (any non-empty string)
- Model: exact name from `GET /v1/models`

### Claude Code / Gemini CLI — OpenAI-compatible shim

```bash
# Point the CLI at your local server
ANTHROPIC_BASE_URL=http://localhost:8080/v1 \
ANTHROPIC_API_KEY=local \
claude --model qwen2.5-coder:14b
```

### Direct API (any language)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="local"          # required but ignored
)

response = client.chat.completions.create(
    model="qwen2.5-coder:7b",
    messages=[{"role": "user", "content": "Write a Python hello world"}]
)
print(response.choices[0].message.content)
```

---

## Step 5 — Performance tuning

### GPU layer offload (llama.cpp / Ollama)

```bash
# In llama-server: increase until VRAM is nearly full
--n-gpu-layers 35    # 7B model, 8 GB VRAM
--n-gpu-layers 99    # offload everything (small model / lots of VRAM)

# In Ollama: set via Modelfile
FROM qwen2.5-coder:7b
PARAMETER num_gpu 1
```

### Context length

```bash
# Larger context = more memory but better long-file edits
--ctx-size 16384    # good for most coding tasks
--ctx-size 4096     # conservative for weak hardware
```

### Parallel requests (server throughput)

```bash
# llama-server
--parallel 4        # handle up to 4 simultaneous completions
```

### Flash attention (if supported by your build)

```bash
--flash-attn        # faster on CUDA and Metal backends
```

---

## Step 6 — Privacy checklist

Confirm before considering setup complete:

- [ ] Model server is bound to `localhost` or private LAN only
- [ ] No `OLLAMA_HOST=0.0.0.0` without a firewall rule
- [ ] Editor extension's `allowLanHosts` is `false` unless you explicitly want LAN sharing
- [ ] No cloud fallback URLs in config files
- [ ] Model weights were downloaded from a trusted source (Hugging Face official org page or Ollama library)

---

## Troubleshooting quick reference

```
Model loads but output is garbage → wrong quantisation for your hardware; try Q4_K_M
CUDA out of memory → reduce --n-gpu-layers or switch to a smaller model
Ollama "no model" after pull → run: ollama list, check name matches exactly
LM Studio "port in use" → another server is on 1234; change port in Settings
WSL2 (Windows) can't reach localhost from Windows → use host IP: 172.x.x.x or set OLLAMA_HOST=0.0.0.0 inside WSL
```

