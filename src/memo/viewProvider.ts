import * as vscode from 'vscode';

import {
	MemoState,
	MemoStateMessage,
	TERMINAL_NAME,
	getNonce,
	isRecord,
	normalizeHistory,
	type MemoViewId,
} from './core';
import { MemoStore } from './store';

interface HistoryPickItem extends vscode.QuickPickItem {
	value: string;
}

interface FileTagPickItem extends vscode.QuickPickItem {
	value: string;
	sortRank: number;
}

type ShortcutPlatform = 'macos' | 'default';
type ShortcutActionId = 'send' | 'historyPrevious' | 'historyNext' | 'historyList';

interface ShortcutBinding {
	alt: boolean;
	code?: string;
	ctrl: boolean;
	display: string;
	key?: string;
	meta: boolean;
	shift: boolean;
}

interface ShortcutConfig {
	historyList: ShortcutBinding;
	historyNext: ShortcutBinding;
	historyPrevious: ShortcutBinding;
	historyCycleHint: string;
	historyListHint: string;
	send: ShortcutBinding;
	sendPlaceholder: string;
}

interface ShortcutConfigMessage {
	type: 'shortcutConfigChanged';
	shortcutConfig: ShortcutConfig;
}

const FILE_TAG_EXCLUDED_DIRECTORIES = [
	'.git',
	'.venv',
	'venv',
	'.direnv',
	'node_modules',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'.turbo',
	'.cache',
	'.mypy_cache',
	'.pytest_cache',
	'.ruff_cache',
	'.tox',
	'__pycache__',
	'dist',
	'build',
	'out',
	'coverage',
	'target',
	'vendor',
] as const;

const FILE_TAG_EXCLUDE_GLOB = `**/{${FILE_TAG_EXCLUDED_DIRECTORIES.join(',')}}/**`;
const SHORTCUT_CONFIGURATION_SECTION = 'memo2terminal.shortcuts';
const DEFAULT_SHORTCUT_SPECS: Record<ShortcutPlatform, Record<ShortcutActionId, string>> = {
	macos: {
		send: 'Cmd+Enter',
		historyPrevious: 'Cmd+ArrowUp',
		historyNext: 'Cmd+ArrowDown',
		historyList: 'Cmd+Ctrl+H',
	},
	default: {
		send: 'Ctrl+Enter',
		historyPrevious: 'Ctrl+ArrowUp',
		historyNext: 'Ctrl+ArrowDown',
		historyList: 'Ctrl+H',
	},
};

class MemoViewRegistry {
	private readonly views = new Map<MemoViewId, vscode.WebviewView>();
	private shortcutConfig: ShortcutConfig;

	constructor(shortcutConfig: ShortcutConfig) {
		this.shortcutConfig = shortcutConfig;
	}

	register(viewId: MemoViewId, view: vscode.WebviewView): void {
		this.views.set(viewId, view);
	}

	unregister(viewId: MemoViewId, view: vscode.WebviewView): void {
		if (this.views.get(viewId) !== view) {
			return;
		}

		this.views.delete(viewId);
	}

	getShortcutConfig(): ShortcutConfig {
		return this.shortcutConfig;
	}

	updateShortcutConfig(shortcutConfig: ShortcutConfig): void {
		this.shortcutConfig = shortcutConfig;
	}

	broadcastState(state: MemoState, sourceViewId?: MemoViewId, focusViewId?: MemoViewId): void {
		for (const [viewId, view] of this.views) {
			this.postStateToView(viewId, view, 'stateChanged', state, sourceViewId, focusViewId);
		}
	}

	broadcastShortcutConfig(): void {
		for (const view of this.views.values()) {
			this.postShortcutConfigToView(view);
		}
	}

	postStateToView(
		viewId: MemoViewId,
		view: vscode.WebviewView,
		type: MemoStateMessage['type'],
		state: MemoState,
		sourceViewId?: MemoViewId,
		focusViewId?: MemoViewId,
	): void {
		const message: MemoStateMessage = {
			type,
			state,
			focus: viewId === focusViewId,
			sourceViewId,
		};

		void view.webview.postMessage(message);
	}

	postShortcutConfigToView(view: vscode.WebviewView): void {
		const message: ShortcutConfigMessage = {
			type: 'shortcutConfigChanged',
			shortcutConfig: this.shortcutConfig,
		};

		void view.webview.postMessage(message);
	}
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
			this.registry.postShortcutConfigToView(webviewView);
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
				this.registry.postShortcutConfigToView(webviewView);
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
					this.registry.postStateToView(this.viewId, webviewView, 'stateChanged', this.store.snapshot(), undefined, this.viewId);
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
			await vscode.window.showInformationMessage('저장된 히스토리가 없습니다.');
			return undefined;
		}

		const picks: HistoryPickItem[] = history
			.slice()
			.reverse()
			.map((text) => ({
				label: formatHistoryLabel(text),
				description: formatHistoryDescription(text),
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

		const activeFile = vscode.window.activeTextEditor?.document.uri;
		const activeRelativePath =
			activeFile && activeFile.scheme === 'file' ? vscode.workspace.asRelativePath(activeFile, true).replace(/\\/g, '/') : undefined;

		const fileUris = await vscode.workspace.findFiles('**/*', FILE_TAG_EXCLUDE_GLOB);
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
				const sortRank = relativePath === activeRelativePath ? 0 : 1;

				return {
					label,
					description: parentPath.length > 0 ? parentPath : '(워크스페이스 루트)',
					detail: relativePath,
					value: `@${relativePath}`,
					sortRank,
				};
			})
			.sort((left, right) => {
				if (left.sortRank !== right.sortRank) {
					return left.sortRank - right.sortRank;
				}

				return left.value.localeCompare(right.value, 'ko');
			});

		const selected = await vscode.window.showQuickPick(picks, {
			placeHolder: '@로 삽입할 파일을 선택하세요. 현재 파일이 가장 위에 표시됩니다.',
			matchOnDescription: true,
			matchOnDetail: true,
		});

		return selected?.value;
	}

	private getHtml(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'view.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'view.js'));
		const nonce = getNonce();
		const shortcutConfig = this.registry.getShortcutConfig();
		const serializedShortcutConfig = serializeForInlineScript(shortcutConfig);

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
				<textarea id="memo" placeholder="${shortcutConfig.sendPlaceholder}"></textarea>
			<div class="actions">
				<p class="hint"><span id="historyCycleHint">${shortcutConfig.historyCycleHint}</span><br /><span id="historyListHint">${shortcutConfig.historyListHint}</span></p>
				<button id="sendButton" type="button" aria-label="터미널로 전송">
					<span class="sendIcon" aria-hidden="true"></span>
				</button>
			</div>
		</div>
	</div>
	<script nonce="${nonce}">globalThis.__memo2terminalShortcutConfig = ${serializedShortcutConfig};</script>
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

function formatHistoryLabel(text: string): string {
	const firstLine = text.split(/\r?\n/)[0] ?? '';
	const compact = firstLine.trim();
	if (compact.length === 0) {
		return '(빈 줄)';
	}

	return compact.length <= 60 ? compact : `${compact.slice(0, 57)}...`;
}

function formatHistoryDescription(text: string): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return normalized.length <= 90 ? normalized : `${normalized.slice(0, 87)}...`;
}

function resolveShortcutConfig(): ShortcutConfig {
	const platform = process.platform === 'darwin' ? 'macos' : 'default';
	const configuration = vscode.workspace.getConfiguration(SHORTCUT_CONFIGURATION_SECTION);
	const defaults = DEFAULT_SHORTCUT_SPECS[platform];
	const send = resolveShortcutBinding(configuration.get<string>('send'), defaults.send, platform);
	const historyPrevious = resolveShortcutBinding(configuration.get<string>('historyPrevious'), defaults.historyPrevious, platform);
	const historyNext = resolveShortcutBinding(configuration.get<string>('historyNext'), defaults.historyNext, platform);
	const historyList = resolveShortcutBinding(configuration.get<string>('historyList'), defaults.historyList, platform);

	return {
		historyList,
		historyNext,
		historyPrevious,
		historyCycleHint: `${formatHistoryCycleDisplay(historyPrevious, historyNext, platform)} : 히스토리 순환`,
		historyListHint: `${historyList.display} : 히스토리 목록`,
		send,
		sendPlaceholder: `${send.display} 로 터미널에 전송`,
	};
}

function resolveShortcutBinding(
	configuredValue: string | undefined,
	fallbackValue: string,
	platform: ShortcutPlatform,
): ShortcutBinding {
	const fallback = parseShortcutBinding(fallbackValue, platform);
	if (!fallback) {
		throw new Error(`기본 단축키를 해석할 수 없습니다: ${fallbackValue}`);
	}

	const parsed = parseShortcutBinding(configuredValue, platform);
	return parsed ?? fallback;
}

function parseShortcutBinding(rawValue: string | undefined, platform: ShortcutPlatform): ShortcutBinding | undefined {
	if (typeof rawValue !== 'string') {
		return undefined;
	}

	const compactValue = rawValue.trim();
	if (compactValue.length === 0) {
		return undefined;
	}

	const tokens = compactValue
		.split('+')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);

	if (tokens.length === 0) {
		return undefined;
	}

	const keyToken = tokens[tokens.length - 1];
	const key = parseShortcutKey(keyToken, platform);
	if (!key) {
		return undefined;
	}

	const modifiers = {
		alt: false,
		ctrl: false,
		meta: false,
		shift: false,
	};

	for (const token of tokens.slice(0, -1)) {
		const normalizedToken = token.toLowerCase();
		switch (normalizedToken) {
			case 'cmd':
			case 'command':
			case 'meta':
				if (modifiers.meta) {
					return undefined;
				}
				modifiers.meta = true;
				break;
			case 'ctrl':
			case 'control':
				if (modifiers.ctrl) {
					return undefined;
				}
				modifiers.ctrl = true;
				break;
			case 'alt':
			case 'option':
				if (modifiers.alt) {
					return undefined;
				}
				modifiers.alt = true;
				break;
			case 'shift':
				if (modifiers.shift) {
					return undefined;
				}
				modifiers.shift = true;
				break;
			default:
				return undefined;
		}
	}

	return {
		...modifiers,
		code: key.code,
		display: [...getModifierLabels(modifiers, platform), key.label].join(' + '),
		key: key.key,
	};
}

function parseShortcutKey(
	token: string,
	platform: ShortcutPlatform,
): { code?: string; key?: string; label: string } | undefined {
	const normalizedToken = token.toLowerCase();

	switch (normalizedToken) {
		case 'enter':
			return { key: 'Enter', label: 'Enter' };
		case 'up':
		case 'arrowup':
		case 'uparrow':
		case '↑':
			return { key: 'ArrowUp', label: '↑' };
		case 'down':
		case 'arrowdown':
		case 'downarrow':
		case '↓':
			return { key: 'ArrowDown', label: '↓' };
		case 'tab':
			return { key: 'Tab', label: 'Tab' };
		case 'esc':
		case 'escape':
			return { key: 'Escape', label: 'Esc' };
		case 'backspace':
			return { key: 'Backspace', label: platform === 'macos' ? 'Delete' : 'Backspace' };
		case 'space':
			return { code: 'Space', key: ' ', label: 'Space' };
		default:
			break;
	}

	if (/^[a-z]$/i.test(token)) {
		const value = token.toUpperCase();
		return { code: `Key${value}`, label: value };
	}

	if (/^key[a-z]$/i.test(token)) {
		const value = token.slice(-1).toUpperCase();
		return { code: `Key${value}`, label: value };
	}

	if (/^[0-9]$/.test(token)) {
		return { code: `Digit${token}`, label: token };
	}

	if (/^digit[0-9]$/i.test(token)) {
		const value = token.slice(-1);
		return { code: `Digit${value}`, label: value };
	}

	return undefined;
}

function formatHistoryCycleDisplay(
	historyPrevious: ShortcutBinding,
	historyNext: ShortcutBinding,
	platform: ShortcutPlatform,
): string {
	if (
		historyPrevious.key === 'ArrowUp' &&
		historyNext.key === 'ArrowDown' &&
		historyPrevious.code === undefined &&
		historyNext.code === undefined &&
		hasSameShortcutModifiers(historyPrevious, historyNext)
	) {
		const modifiers = getModifierLabels(historyPrevious, platform);
		return modifiers.length === 0 ? '↑/↓' : `${modifiers.join(' + ')} + ↑/↓`;
	}

	return `${historyPrevious.display} / ${historyNext.display}`;
}

function hasSameShortcutModifiers(left: ShortcutBinding, right: ShortcutBinding): boolean {
	return left.alt === right.alt && left.ctrl === right.ctrl && left.meta === right.meta && left.shift === right.shift;
}

function getModifierLabels(
	modifiers: Pick<ShortcutBinding, 'alt' | 'ctrl' | 'meta' | 'shift'>,
	platform: ShortcutPlatform,
): string[] {
	const labels: string[] = [];

	if (modifiers.meta) {
		labels.push(platform === 'macos' ? 'Cmd' : 'Meta');
	}

	if (modifiers.ctrl) {
		labels.push('Ctrl');
	}

	if (modifiers.alt) {
		labels.push(platform === 'macos' ? 'Option' : 'Alt');
	}

	if (modifiers.shift) {
		labels.push('Shift');
	}

	return labels;
}

function serializeForInlineScript(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

export { Memo2TerminalViewProvider, MemoViewRegistry, resolveShortcutConfig };
