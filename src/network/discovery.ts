import * as dgram from 'dgram';
import * as http from 'http';
import * as os from 'os';
import * as crypto from 'crypto';
import { isPrivateLan, isLoopback } from '../localGuard';

/**
 * Opt-in LAN presence/discovery for Sovereign Agent.
 *
 * What it does:
 *  - Broadcasts a small UDP announcement ("I'm here") on the local subnet.
 *  - Listens for the same announcements from other Sovereign Agent instances.
 *  - Serves a tiny read-only HTTP "info" endpoint so a peer can confirm who you are.
 *
 * What it deliberately does NOT do:
 *  - It never executes tools, reads files, or relays chat/model traffic for a peer.
 *  - It never accepts connections from anything that is not loopback or a
 *    private LAN address (reuses the same guard as the LLM backend).
 *  - It is fully opt-in: disabled unless the user explicitly turns it on.
 */

const DISCOVERY_PORT = 48100; // UDP announce/listen port
const ANNOUNCE_INTERVAL_MS = 5000;
const PEER_TTL_MS = 15000; // drop a peer if not heard from in this long
const PROTOCOL_MARKER = 'sovereign-agent-announce/1';

export interface PeerInfo {
  id: string;
  name: string;
  workspace: string;
  host: string;
  httpPort: number;
  version: string;
  lastSeen: number;
}

export interface DiscoveryOptions {
  displayName: string;
  workspaceName: string;
  version: string;
  allowLan: boolean; // reuses sovereignAgent.allowLanHosts semantics
  onPeersChanged?: (peers: PeerInfo[]) => void;
  onLog?: (line: string) => void;
}

function localIPv4Addresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        out.push(a.address);
      }
    }
  }
  return out;
}

function broadcastAddressesFor(addresses: string[]): string[] {
  // Best-effort /24 broadcast guess per interface, plus the generic
  // limited broadcast address as a fallback.
  const guesses = addresses.map((ip) => {
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = '255';
      return parts.join('.');
    }
    return undefined;
  }).filter((x): x is string => !!x);
  return Array.from(new Set([...guesses, '255.255.255.255']));
}

export class DiscoveryService {
  readonly id: string = crypto.randomUUID();
  private socket: dgram.Socket | undefined;
  private httpServer: http.Server | undefined;
  private httpPort = 0;
  private announceTimer: NodeJS.Timeout | undefined;
  private peers = new Map<string, PeerInfo>();
  private pruneTimer: NodeJS.Timeout | undefined;

  constructor(private opts: DiscoveryOptions) {}

  get isRunning(): boolean {
    return !!this.socket;
  }

  listPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }
    if (!this.opts.allowLan) {
      this.log('LAN discovery is disabled (sovereignAgent.allowLanHosts / allowNetworkDiscovery is off).');
      return;
    }

    await this.startHttpServer();
    await this.startUdp();

    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
    this.pruneTimer = setInterval(() => this.prunePeers(), ANNOUNCE_INTERVAL_MS);
    this.announce();
    this.log(`Discovery started. id=${this.id} httpPort=${this.httpPort}`);
  }

  stop(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.announceTimer = undefined;
    this.pruneTimer = undefined;

    this.socket?.close();
    this.socket = undefined;

    this.httpServer?.close();
    this.httpServer = undefined;

    this.peers.clear();
    this.log('Discovery stopped.');
  }

  private log(line: string): void {
    this.opts.onLog?.(line);
  }

  private notifyPeers(): void {
    this.opts.onPeersChanged?.(this.listPeers());
  }

  private async startHttpServer(): Promise<void> {
    this.httpServer = http.createServer((req, res) => {
      const remote = req.socket.remoteAddress?.replace('::ffff:', '') ?? '';
      if (!isLoopback(remote) && !(this.opts.allowLan && isPrivateLan(remote))) {
        res.writeHead(403).end();
        return;
      }
      if (req.method === 'GET' && req.url === '/sovereign-agent/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: this.id,
            name: this.opts.displayName,
            workspace: this.opts.workspaceName,
            version: this.opts.version
          })
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      // Port 0 -> OS assigns a free local port; we advertise it via UDP.
      this.httpServer!.listen(0, '0.0.0.0', () => {
        const addr = this.httpServer!.address();
        this.httpPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  }

  private async startUdp(): Promise<void> {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg, rinfo) => {
      if (!isLoopback(rinfo.address) && !isPrivateLan(rinfo.address)) {
        return; // never trust anything outside the local network
      }
      this.handleMessage(msg, rinfo.address);
    });

    this.socket.on('error', (err) => this.log(`UDP error: ${String(err)}`));

    await new Promise<void>((resolve, reject) => {
      this.socket!.once('error', reject);
      this.socket!.bind(DISCOVERY_PORT, () => {
        this.socket!.setBroadcast(true);
        resolve();
      });
    });
  }

  private handleMessage(msg: Buffer, fromAddress: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as Record<string, unknown>).marker !== PROTOCOL_MARKER
    ) {
      return;
    }
    const p = parsed as Record<string, unknown>;
    const id = String(p.id ?? '');
    if (!id || id === this.id) {
      return; // ignore our own announcements
    }
    const info: PeerInfo = {
      id,
      name: String(p.name ?? 'Sovereign Agent'),
      workspace: String(p.workspace ?? ''),
      host: fromAddress,
      httpPort: Number(p.httpPort ?? 0),
      version: String(p.version ?? ''),
      lastSeen: Date.now()
    };
    const isNew = !this.peers.has(id);
    this.peers.set(id, info);
    if (isNew) {
      this.log(`Discovered peer "${info.name}" at ${info.host} (${info.workspace || 'no workspace'}).`);
    }
    this.notifyPeers();
  }

  private prunePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TTL_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.notifyPeers();
    }
  }

  private announce(): void {
    if (!this.socket) {
      return;
    }
    const payload = Buffer.from(
      JSON.stringify({
        marker: PROTOCOL_MARKER,
        id: this.id,
        name: this.opts.displayName,
        workspace: this.opts.workspaceName,
        httpPort: this.httpPort,
        version: this.opts.version
      }),
      'utf8'
    );
    for (const addr of broadcastAddressesFor(localIPv4Addresses())) {
      this.socket.send(payload, DISCOVERY_PORT, addr, (err) => {
        if (err) {
          this.log(`Broadcast to ${addr} failed: ${String(err)}`);
        }
      });
    }
  }
}
