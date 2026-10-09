/**
 * Enforces the "local only" promise: the extension refuses to talk to
 * anything that is not loopback (or, optionally, a private LAN address).
 */

function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '[::1]' ||
    h === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

function isPrivateLan(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith('.local')) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) {
    return false;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function isAllowedHost(hostname: string, allowLan: boolean): boolean {
  return isLoopback(hostname) || (allowLan && isPrivateLan(hostname));
}

export type GuardResult = { ok: true; url: URL } | { ok: false; reason: 'invalid' | 'notLocal' };

export function checkLocalUrl(raw: string, allowLan: boolean): GuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'invalid' };
  }
  if (!isAllowedHost(url.hostname, allowLan)) {
    return { ok: false, reason: 'notLocal' };
  }
  return { ok: true, url };
}
