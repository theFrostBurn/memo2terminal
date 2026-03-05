import * as vscode from 'vscode';

import {
	DEFAULT_VIEW_ID,
	MEMO_STATE_KEY,
	areStringArraysEqual,
	clampSelection,
	isMemoViewId,
	mergeHistory,
	normalizeHistory,
	pushHistory,
	type MemoState,
	type MemoViewId,
	type PersistedMemoState,
} from './core';

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

export { MemoStore };
