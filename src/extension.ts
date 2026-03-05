import * as vscode from 'vscode';

const VIEW_ID = 'memo2terminal.view';
const TERMINAL_NAME = 'Memo2Terminal';

export function activate(context: vscode.ExtensionContext): void {
	const provider = new Memo2TerminalViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
			webviewOptions: {
				retainContextWhenHidden: true,
			},
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('memo2terminal.focusView', async () => {
			await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		}),
	);
}

class Memo2TerminalViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
			if (isSendMessage(message)) {
				if (message.text.trim().length === 0) {
					return;
				}

				const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal(TERMINAL_NAME);
				terminal.show(true);
				terminal.sendText(message.text, true);
				const sentMessage: SentMessage = {
					type: 'sent',
					ok: true,
					text: message.text,
				};
				void webviewView.webview.postMessage(sentMessage);
				return;
			}

			if (isOpenHistoryMessage(message)) {
				const selected = await this.pickHistory(message.history);
				if (selected === undefined) {
					return;
				}

				const selectedMessage: HistorySelectedMessage = {
					type: 'historySelected',
					text: selected,
				};
				void webviewView.webview.postMessage(selectedMessage);
			}
		});
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
<body>
	<div class="container">
		<textarea id="memo" placeholder="메모 입력 후 Ctrl+Enter 또는 전송 버튼"></textarea>
		<div class="actions">
			<p class="hint">Cmd+↑/↓: 히스토리 순회 · Cmd+Ctrl+H: 히스토리 목록</p>
			<button id="sendButton" type="button">터미널로 전송</button>
		</div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
		}

	private async pickHistory(history: string[]): Promise<string | undefined> {
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
}

interface SendMessage {
	type: 'send';
	text: string;
}

interface OpenHistoryMessage {
	type: 'openHistory';
	history: string[];
}

interface SentMessage {
	type: 'sent';
	ok: boolean;
	text: string;
}

interface HistorySelectedMessage {
	type: 'historySelected';
	text: string;
}

interface HistoryPickItem extends vscode.QuickPickItem {
	value: string;
}

function isSendMessage(value: unknown): value is SendMessage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return candidate.type === 'send' && typeof candidate.text === 'string';
}

function isOpenHistoryMessage(value: unknown): value is OpenHistoryMessage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	if (candidate.type !== 'openHistory' || !Array.isArray(candidate.history)) {
		return false;
	}

	return candidate.history.every((item) => typeof item === 'string');
}

function toQuickPickLabel(text: string): string {
	const firstLine = text.split(/\r?\n/)[0] ?? '';
	const compact = firstLine.trim();
	if (compact.length === 0) {
		return '(빈 줄)';
	}

	if (compact.length <= 60) {
		return compact;
	}

	return `${compact.slice(0, 57)}...`;
}

function toQuickPickDescription(text: string): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (normalized.length <= 90) {
		return normalized;
	}
	return `${normalized.slice(0, 87)}...`;
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';

	for (let index = 0; index < 32; index += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}

	return nonce;
}

export function deactivate(): void {}
