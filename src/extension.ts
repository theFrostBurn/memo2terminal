import * as vscode from 'vscode';

import { MEMO_VIEW_IDS } from './memo/core';
import { MemoStore } from './memo/store';
import { Memo2TerminalViewProvider, MemoViewRegistry } from './memo/viewProvider';

let activeStore: MemoStore | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const store = new MemoStore(context);
	const registry = new MemoViewRegistry();
	activeStore = store;

	for (const viewId of MEMO_VIEW_IDS) {
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				viewId,
				new Memo2TerminalViewProvider(viewId, context.extensionUri, store, registry),
				{
					webviewOptions: {
						retainContextWhenHidden: true,
					},
				},
			),
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('memo2terminal.focusView', async () => {
			await vscode.commands.executeCommand(`${store.getLastActiveViewId()}.focus`);
		}),
	);
}

export function deactivate(): void {
	activeStore?.flushPersist();
}
