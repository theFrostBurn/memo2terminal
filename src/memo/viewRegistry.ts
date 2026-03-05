import * as vscode from 'vscode';

import type { MemoState, MemoStateMessage, MemoViewId } from './core';

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

export { MemoViewRegistry };
