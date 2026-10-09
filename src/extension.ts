import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri, context);
  context.subscriptions.push({ dispose: () => provider.dispose() });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('sovereignAgent.newChat', () => provider.newChat()),
    vscode.commands.registerCommand('sovereignAgent.selectModel', () => provider.selectModel()),
    vscode.commands.registerCommand('sovereignAgent.stop', () => provider.stop()),
    vscode.commands.registerCommand('sovereignAgent.undo', () => provider.undo()),
    vscode.commands.registerCommand('sovereignAgent.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ertugrul37.sovereign-agent')
    ),
    vscode.commands.registerCommand('sovereignAgent.addSelectionToChat', () => provider.addSelectionToChat()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sovereignAgent')) {
        provider.refresh();
      }
    })
  );
}

export function deactivate(): void {}
