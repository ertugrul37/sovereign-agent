import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatViewProvider';
import { DiscoveryService, PeerInfo } from './network/discovery';
import { getConfig } from './config';

let discovery: DiscoveryService | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

function renderStatusBar(peers: PeerInfo[]): void {
  if (!statusBarItem) {
    return;
  }
  if (!discovery?.isRunning) {
    statusBarItem.hide();
    return;
  }
  statusBarItem.text = `$(radio-tower) ${peers.length}`;
  statusBarItem.tooltip = peers.length
    ? `Sovereign Agent: ${peers.length} peer(s) on the local network`
    : 'Sovereign Agent: network discovery is on, no peers found yet';
  statusBarItem.show();
}

async function syncDiscovery(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
  const cfg = getConfig();
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? '';
  const version = (context.extension.packageJSON.version as string) ?? '0.0.0';

  if (cfg.enableNetworkDiscovery && !discovery) {
    discovery = new DiscoveryService({
      displayName: cfg.discoveryDisplayName || `${os_hostname()} (${workspaceName || 'no workspace'})`,
      workspaceName,
      version,
      allowLan: cfg.allowLanHosts,
      onPeersChanged: renderStatusBar,
      onLog: (line) => outputChannel.appendLine(`[discovery] ${line}`)
    });
    try {
      await discovery.start();
    } catch (err) {
      outputChannel.appendLine(`[discovery] failed to start: ${String(err)}`);
      vscode.window.showWarningMessage('Sovereign Agent: could not start local network discovery. See the output channel for details.');
      discovery = undefined;
    }
  } else if (!cfg.enableNetworkDiscovery && discovery) {
    discovery.stop();
    discovery = undefined;
    renderStatusBar([]);
  }
}

function os_hostname(): string {
  try {
    // Lazy require to avoid importing os at module scope just for a label.
    return require('os').hostname();
  } catch {
    return 'Sovereign Agent';
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri, context);
  context.subscriptions.push({ dispose: () => provider.dispose() });

  const outputChannel = vscode.window.createOutputChannel('Sovereign Agent');
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'sovereignAgent.showNetworkPeers';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('sovereignAgent.newChat', () => provider.newChat()),
    vscode.commands.registerCommand('sovereignAgent.selectModel', () => provider.selectModel()),
    vscode.commands.registerCommand('sovereignAgent.selectCompareModel', () => provider.selectCompareModel()),
    vscode.commands.registerCommand('sovereignAgent.stop', () => provider.stop()),
    vscode.commands.registerCommand('sovereignAgent.undo', () => provider.undo()),
    vscode.commands.registerCommand('sovereignAgent.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ertugrul37.sovereign-agent')
    ),
    vscode.commands.registerCommand('sovereignAgent.openFeedback', () => provider.openFeedback()),
    vscode.commands.registerCommand('sovereignAgent.openPreview', () => provider.openPreview()),
    vscode.commands.registerCommand('sovereignAgent.openGraphify', () => provider.openGraphify()),
    vscode.commands.registerCommand('sovereignAgent.rateExtension', () => provider.rateExtension()),
    vscode.commands.registerCommand('sovereignAgent.selectLanguage', () => provider.selectLanguage()),
    vscode.commands.registerCommand('sovereignAgent.addSelectionToChat', () => provider.addSelectionToChat()),
    vscode.commands.registerCommand('sovereignAgent.showNetworkPeers', async () => {
      if (!discovery?.isRunning) {
        const choice = await vscode.window.showInformationMessage(
          'Local network discovery is off. This lets other people running Sovereign Agent on your LAN see this machine. Turn it on?',
          'Enable',
          'Cancel'
        );
        if (choice === 'Enable') {
          await vscode.workspace.getConfiguration('sovereignAgent').update('enableNetworkDiscovery', true, vscode.ConfigurationTarget.Global);
        }
        return;
      }
      const peers = discovery.listPeers();
      if (!peers.length) {
        vscode.window.showInformationMessage('Sovereign Agent: no peers found on the local network yet.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        peers.map((p) => ({
          label: p.name,
          description: `${p.workspace || 'no workspace'} — ${p.host}:${p.httpPort}`,
          peer: p
        })),
        { placeHolder: 'Sovereign Agent peers on your local network' }
      );
      if (picked) {
        vscode.env.openExternal(vscode.Uri.parse(`http://${picked.peer.host}:${picked.peer.httpPort}/sovereign-agent/info`));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sovereignAgent')) {
        provider.refresh();
        void syncDiscovery(context, outputChannel);
      }
    })
  );

  void syncDiscovery(context, outputChannel);
}

export function deactivate(): void {
  discovery?.stop();
  discovery = undefined;
}
