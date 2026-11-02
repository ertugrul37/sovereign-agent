# Agensi Skills — Sovereign Agent

Bu klasör, Agensi.io marketinde listelenmeye hazır skill paketlerini ve beraberindeki otomasyon scriptlerini içerir.
Sovereign Agent VS Code eklentisinin yerel ve gizlilik odaklı mimarisini bağımsız araçlar olarak paketler.

---

## Paketler ve Scriptler

### 1. `local-ai-dev-setup`
*Yerel AI Geliştirme Ortamı Kurulumu ve Doğrulaması*
- `SKILL.md`: Donanım tespiti, Ollama/LM Studio/llama.cpp rehberi, test adımları.
- `scripts/setup.ps1`: Windows için otomatik donanım tespiti, Ollama kontrolü, model indirme ve smoke test.
- `scripts/setup.sh`: Linux/macOS için bash tabanlı otomatik kurulum scripti.

### 2. `privacy-code-review`
*Gizlilik Odaklı Kod İnceleme ve Güvenlik Taraması*
- `SKILL.md`: 4 katmanlı derinlemesine inceleme protokolü (Güvenlik, Doğruluk, Tasarım, Stil).
- `scripts/review.ps1`: Git diff veya dosyaları okuyup yerel model üzerinden raporlayan PowerShell scripti (`-Save` ile markdown çıktı üretir).
- `scripts/review.sh`: Linux/macOS için curl & jq destekli CLI code-review scripti.

### 3. `vscode-local-agent-config`
*VS Code & AI Ajanlarını Yerel Modellere Bağlama*
- `SKILL.md`: Sovereign Agent, Continue.dev ve Cursor için ayar kılavuzu.
- `scripts/configure.ps1`: Windows `settings.json` ve `.continue/config.json` dosyalarını yedekleyerek otomatik güncelleyen script.
- `scripts/configure.sh`: Linux ve macOS için otomatik JSON yapılandırma scripti.

---

## Agensi.io Listeleme Notları

- **Fiyatlandırma:** $5 – $9 arası tek seferlik alım.
- **Güvenlik Güvencesi:** Tüm scriptler `localhost` veya `192.168.x.x` gibi yerel ağ dışına çıkışı kod seviyesinde engeller (IP Guard).
- **Yedekleme:** Ayar değiştiren scriptler orijinal JSON dosyalarının `.bak` yedeğini otomatik alır.
