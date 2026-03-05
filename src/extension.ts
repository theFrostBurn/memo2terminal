import * as vscode from 'vscode';

const EXPLORER_VIEW_ID = 'memo2terminal.view';
const SCM_VIEW_ID = 'memo2terminal.scmView';
const DEFAULT_VIEW_ID = EXPLORER_VIEW_ID;
const HISTORY_LIMIT = 15;
const MEMO_STATE_KEY = 'memo2terminal.state.v1';
const TERMINAL_NAME = 'Memo2Terminal';

const VIEW_IDS = [EXPLORER_VIEW_ID, SCM_VIEW_ID] as const;

type MemoViewId = (typeof VIEW_IDS)[number];

interface PersistedMemoState {
	draft: string;
	selectionStart: number;
	selectionEnd: number;
	history: string[];
	lastActiveViewId: MemoViewId;
}

interface MemoState extends PersistedMemoState {
	revision: number;
}

interface MemoStateMessage {
	type: 'hydrate' | 'stateChanged';
	state: MemoState;
	focus: boolean;
	sourceViewId?: MemoViewId;
}

interface ReadyMessage {
	type: 'ready';
	viewId: MemoViewId;
	legacyHistory?: string[];
}

let activeStore: MemoStore | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const store = new MemoStore(context);
	const registry = new MemoViewRegistry();
	activeStore = store;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			EXPLORER_VIEW_ID,
			new Memo2TerminalViewProvider(EXPLORER_VIEW_ID, context.extensionUri, store, registry),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			},
		),
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SCM_VIEW_ID,
			new Memo2TerminalViewProvider(SCM_VIEW_ID, context.extensionUri, store, registry),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('memo2terminal.focusView', async () => {
			await vscode.commands.executeCommand(`${store.getLastActiveViewId()}.focus`);
		}),
	);
}

export function deactivate(): void {
	activeStore?.flushPersist();
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
}

class MemoStore {
	private readonly state: MemoState;

	private persistTimer: NodeJS.Timeout | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		const persisted = context.workspaceState.get<Partial<PersistedMemoState>>(MEMO_STATE_KEY);
		const draft = typeof persisted?.draft === 'string' ? persisted.draft : '';
		const selection = clampSelection(draft, persisted?.selectionStart ?? 0, persisted?.selectionEnd ?? 0);

		this.state = {
			draft,
			selectionStart: selection.start,
			selectionEnd: selection.end,
			history: normalizeHistory(persisted?.history),
			lastActiveViewId: isMemoViewId(persisted?.lastActiveViewId) ? persisted.lastActiveViewId : DEFAULT_VIEW_ID,
			revision: 0,
		};
	}

	snapshot(): MemoState {
		return {
			draft: this.state.draft,
			selectionStart: this.state.selectionStart,
			selectionEnd: this.state.selectionEnd,
			history: [...this.state.history],
			lastActiveViewId: this.state.lastActiveViewId,
			revision: this.state.revision,
		};
	}

	getLastActiveViewId(): MemoViewId {
		return this.state.lastActiveViewId;
	}

	importLegacyHistory(history: string[]): boolean {
		if (history.length === 0) {
			return false;
		}

		const mergedHistory = mergeHistory(this.state.history, history);
		if (areStringArraysEqual(mergedHistory, this.state.history)) {
			return false;
		}

		this.state.history = mergedHistory;
		this.state.revision += 1;
		this.schedulePersist();
		return true;
	}

	recordFocus(viewId: MemoViewId): void {
		if (this.state.lastActiveViewId === viewId) {
			return;
		}

		this.state.lastActiveViewId = viewId;
		this.schedulePersist();
	}

	updateDraft(viewId: MemoViewId, draft: string, selectionStart: number, selectionEnd: number): boolean {
		const selection = clampSelection(draft, selectionStart, selectionEnd);
		const hasChanged =
			this.state.draft !== draft ||
			this.state.selectionStart !== selection.start ||
			this.state.selectionEnd !== selection.end;

		this.state.lastActiveViewId = viewId;
		if (!hasChanged) {
			this.schedulePersist();
			return false;
		}

		this.state.draft = draft;
		this.state.selectionStart = selection.start;
		this.state.selectionEnd = selection.end;
		this.state.revision += 1;
		this.schedulePersist();
		return true;
	}

	updateSelection(viewId: MemoViewId, selectionStart: number, selectionEnd: number): boolean {
		const selection = clampSelection(this.state.draft, selectionStart, selectionEnd);
		const hasChanged =
			this.state.selectionStart !== selection.start || this.state.selectionEnd !== selection.end;

		this.state.lastActiveViewId = viewId;
		if (!hasChanged) {
			this.schedulePersist();
			return false;
		}

		this.state.selectionStart = selection.start;
		this.state.selectionEnd = selection.end;
		this.state.revision += 1;
		this.schedulePersist();
		return true;
	}

	applyHistorySelection(viewId: MemoViewId, text: string): void {
		const selection = clampSelection(text, text.length, text.length);
		const hasChanged =
			this.state.draft !== text ||
			this.state.selectionStart !== selection.start ||
			this.state.selectionEnd !== selection.end;

		this.state.draft = text;
		this.state.selectionStart = selection.start;
		this.state.selectionEnd = selection.end;
		this.state.lastActiveViewId = viewId;
		if (hasChanged) {
			this.state.revision += 1;
		}

		this.schedulePersist();
	}

	applySent(viewId: MemoViewId, text: string): void {
		this.state.history = pushHistory(this.state.history, text);
		this.state.draft = '';
		this.state.selectionStart = 0;
		this.state.selectionEnd = 0;
		this.state.lastActiveViewId = viewId;
		this.state.revision += 1;
		this.schedulePersist();
	}

	flushPersist(): void {
		if (this.persistTimer !== undefined) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}

		this.persistNow();
	}

	private schedulePersist(): void {
		if (this.persistTimer !== undefined) {
			clearTimeout(this.persistTimer);
		}

		this.persistTimer = setTimeout(() => {
			this.persistTimer = undefined;
			this.persistNow();
		}, 150);
	}

	private persistNow(): void {
		const persisted: PersistedMemoState = {
			draft: this.state.draft,
			selectionStart: this.state.selectionStart,
			selectionEnd: this.state.selectionEnd,
			history: [...this.state.history],
			lastActiveViewId: this.state.lastActiveViewId,
		};

		void this.context.workspaceState.update(MEMO_STATE_KEY, persisted);
	}
}

class MemoViewRegistry {
	private readonly views = new Map<MemoViewId, vscode.WebviewView>();

	register(viewId: MemoViewId, view: vscode.WebviewView): void {
		this.views.set(viewId, view);
	}

	unregister(viewId: MemoViewId, view: vscode.WebviewView): void {
		if (this.views.get(viewId) !== view) {
			return;
		}

		this.views.delete(viewId);
	}

	broadcastState(state: MemoState, sourceViewId?: MemoViewId, focusViewId?: MemoViewId): void {
		for (const [viewId, view] of this.views) {
			this.postStateToView(viewId, view, 'stateChanged', state, sourceViewId, focusViewId);
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
}

interface HistoryPickItem extends vscode.QuickPickItem {
	value: string;
}

function isMemoViewId(value: unknown): value is MemoViewId {
	return value === EXPLORER_VIEW_ID || value === SCM_VIEW_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function clampSelection(text: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
	const maxIndex = text.length;
	const start = clampNumber(selectionStart, 0, maxIndex);
	const end = clampNumber(selectionEnd, start, maxIndex);
	return { start, end };
}

function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}

	return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeHistory(history: unknown): string[] {
	if (!Array.isArray(history)) {
		return [];
	}

	return history.filter((item): item is string => typeof item === 'string').slice(-HISTORY_LIMIT);
}

function pushHistory(history: string[], text: string): string[] {
	const normalized = text.trim();
	if (normalized.length === 0) {
		return history;
	}

	if (history.length > 0 && history[history.length - 1] === text) {
		return history;
	}

	const nextHistory = [...history, text];
	if (nextHistory.length > HISTORY_LIMIT) {
		return nextHistory.slice(nextHistory.length - HISTORY_LIMIT);
	}

	return nextHistory;
}

function mergeHistory(currentHistory: string[], incomingHistory: string[]): string[] {
	const nextHistory = [...currentHistory];

	for (const text of incomingHistory) {
		const normalized = text.trim();
		if (normalized.length === 0) {
			continue;
		}

		if (nextHistory.includes(text)) {
			continue;
		}

		nextHistory.push(text);
	}

	if (nextHistory.length > HISTORY_LIMIT) {
		return nextHistory.slice(nextHistory.length - HISTORY_LIMIT);
	}

	return nextHistory;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	return left.every((value, index) => value === right[index]);
}

function sendTextToTerminal(text: string): void {
	const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal(TERMINAL_NAME);
	terminal.show(true);
	terminal.sendText(text, true);
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
