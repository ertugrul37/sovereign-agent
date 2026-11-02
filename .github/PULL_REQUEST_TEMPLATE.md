## Summary

Describe the changes introduced by this pull request.

## Privacy & Security Checklist (`localGuard`)

- [ ] No external/cloud URLs, telemetry, or third-party analytics were introduced.
- [ ] All network calls pass through `checkLocalUrl()` in `src/localGuard.ts`.
- [ ] All workspace file operations pass through `safePath()` in `src/agent/tools.ts`.
- [ ] All 16 locale dictionaries expose matching UI keys (`npm test` passes).
