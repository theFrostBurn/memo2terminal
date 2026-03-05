const EXPLORER_VIEW_ID = 'memo2terminal.view';
const SCM_VIEW_ID = 'memo2terminal.scmView';
const DEFAULT_VIEW_ID = EXPLORER_VIEW_ID;
const HISTORY_LIMIT = 15;
const MEMO_STATE_KEY = 'memo2terminal.state.v1';
const TERMINAL_NAME = 'Memo2Terminal';

const MEMO_VIEW_IDS = [EXPLORER_VIEW_ID, SCM_VIEW_ID] as const;

type MemoViewId = (typeof MEMO_VIEW_IDS)[number];

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

export {
	DEFAULT_VIEW_ID,
	EXPLORER_VIEW_ID,
	HISTORY_LIMIT,
	MEMO_STATE_KEY,
	MEMO_VIEW_IDS,
	SCM_VIEW_ID,
	TERMINAL_NAME,
	areStringArraysEqual,
	clampSelection,
	getNonce,
	isMemoViewId,
	isRecord,
	mergeHistory,
	normalizeHistory,
	pushHistory,
	toQuickPickDescription,
	toQuickPickLabel,
};

export type { MemoState, MemoStateMessage, MemoViewId, PersistedMemoState };
