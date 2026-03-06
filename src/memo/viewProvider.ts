import * as vscode from 'vscode';

import {
	TERMINAL_NAME,
	getNonce,
	isRecord,
	normalizeHistory,
	toQuickPickDescription,
	toQuickPickLabel,
	type MemoViewId,
} from './core';
import { MemoStore } from './store';
import { MemoViewRegistry } from './viewRegistry';

interface HistoryPickItem extends vscode.QuickPickItem {
	value: string;
}

interface FileTagPickItem extends vscode.QuickPickItem {
	value: string;
}

class Memo2TerminalViewProvider implements vscode.WebviewViewProvider {
	constructor(
		private readonly viewId: MemoViewId,
		private readonly extensionUri: vscode.Uri,
		private readonly store: MemoStore,
		private readonly registry: MemoViewRegistry,
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.registry.register(this.viewId, webviewView);

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		const receiveDisposable = webviewView.webview.onDidReceiveMessage((message: unknown) => {
			void this.handleMessage(webviewView, message);
		});

		const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
			if (!webviewView.visible) {
				return;
			}

			this.registry.postStateToView(this.viewId, webviewView, 'stateChanged', this.store.snapshot());
		});

		const disposeDisposable = webviewView.onDidDispose(() => {
			this.registry.unregister(this.viewId, webviewView);
			receiveDisposable.dispose();
			visibilityDisposable.dispose();
			disposeDisposable.dispose();
		});
	}

	private async handleMessage(webviewView: vscode.WebviewView, message: unknown): Promise<void> {
		if (!isRecord(message) || message.viewId !== this.viewId || typeof message.type !== 'string') {
			return;
		}

		switch (message.type) {
			case 'ready': {
				const legacyHistory = normalizeHistory(message.legacyHistory);
				if (legacyHistory.length > 0 && this.store.importLegacyHistory(legacyHistory)) {
					this.registry.broadcastState(this.store.snapshot());
				}

				this.registry.postStateToView(this.viewId, webviewView, 'hydrate', this.store.snapshot());
				return;
			}
			case 'focusChanged':
				this.store.recordFocus(this.viewId);
				return;
			case 'inputChanged':
				if (
					typeof message.text !== 'string' ||
					typeof message.selectionStart !== 'number' ||
					typeof message.selectionEnd !== 'number'
				) {
					return;
				}

				if (!this.store.updateDraft(this.viewId, message.text, message.selectionStart, message.selectionEnd)) {
					return;
				}

				this.registry.broadcastState(this.store.snapshot(), this.viewId);
				return;
			case 'selectionChanged':
				if (typeof message.selectionStart !== 'number' || typeof message.selectionEnd !== 'number') {
					return;
				}

				if (!this.store.updateSelection(this.viewId, message.selectionStart, message.selectionEnd)) {
					return;
				}

				this.registry.broadcastState(this.store.snapshot(), this.viewId);
				return;
			case 'send':
				if (typeof message.text !== 'string' || message.text.trim().length === 0) {
					return;
				}

				sendTextToTerminal(message.text);
				this.store.applySent(this.viewId, message.text);
				this.registry.broadcastState(this.store.snapshot(), this.viewId, this.viewId);
				return;
			case 'openHistory': {
				const selected = await this.pickHistory();
				if (selected === undefined) {
					return;
				}

				this.store.applyHistorySelection(this.viewId, selected);
				this.registry.broadcastState(this.store.snapshot(), this.viewId, this.viewId);
				return;
			}
			case 'pickFileTag': {
				const selected = await this.pickFileTag();
				await webviewView.webview.postMessage({
					type: 'fileTagPicked',
					text: selected ?? null,
				});
				return;
			}
			default:
				return;
		}
	}

	private async pickHistory(): Promise<string | undefined> {
		const history = this.store.snapshot().history;
		if (history.length === 0) {
			void vscode.window.showInformationMessage('저장된 히스토리가 없습니다.');
			return undefined;
		}

		const picks: HistoryPickItem[] = history
			.slice()
			.reverse()
			.map((text) => ({
				label: toQuickPickLabel(text),
				description: toQuickPickDescription(text),
				value: text,
			}));

		const selected = await vscode.window.showQuickPick(picks, {
			placeHolder: '최근 전송 히스토리(최대 15개)',
			matchOnDescription: true,
		});

		return selected?.value;
	}

	private async pickFileTag(): Promise<string | undefined> {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			void vscode.window.showInformationMessage('열려 있는 워크스페이스 파일이 없습니다.');
			return undefined;
		}

		const fileUris = await vscode.workspace.findFiles('**/*', undefined, 2000);
		if (fileUris.length === 0) {
			void vscode.window.showInformationMessage('태깅할 수 있는 파일을 찾지 못했습니다.');
			return undefined;
		}

		const picks: FileTagPickItem[] = fileUris
			.map((uri) => {
				const relativePath = vscode.workspace.asRelativePath(uri, true).replace(/\\/g, '/');
				const pathSegments = relativePath.split('/');
				const label = pathSegments[pathSegments.length - 1] ?? relativePath;
				const parentPath = pathSegments.slice(0, -1).join('/');

				return {
					label,
					description: parentPath.length > 0 ? parentPath : '(워크스페이스 루트)',
					detail: relativePath,
					value: `@${relativePath}`,
				};
			})
			.sort((left, right) => left.value.localeCompare(right.value, 'ko'));

		const selected = await vscode.window.showQuickPick(picks, {
			placeHolder: '@로 삽입할 파일을 선택하세요',
			matchOnDescription: true,
			matchOnDetail: true,
		});

		return selected?.value;
	}

	private getHtml(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'view.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'view.js'));
		const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="ko">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Memo2Terminal</title>
</head>
<body data-view-id="${this.viewId}">
	<div class="container">
		<div class="panel">
			<textarea id="memo" placeholder="메모 입력 후 Ctrl+Enter 또는 전송 버튼"></textarea>
			<div class="actions">
				<p class="hint">Cmd+↑/↓: 히스토리 순환<br />Cmd+Ctrl+H: 히스토리 목록</p>
				<button id="sendButton" type="button" aria-label="터미널로 전송">
					<span class="sendIcon" aria-hidden="true"></span>
				</button>
			</div>
		</div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function sendTextToTerminal(text: string): void {
	const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal(TERMINAL_NAME);
	terminal.show(true);
	terminal.sendText(text, true);
}

export { Memo2TerminalViewProvider };
