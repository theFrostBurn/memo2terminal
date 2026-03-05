(function () {
	const vscode = acquireVsCodeApi();
	const memo = document.getElementById('memo');
	const sendButton = document.getElementById('sendButton');
	const viewId = document.body.dataset.viewId;
	const LEGACY_HISTORY_KEY = 'memo2terminal.history.v1';

	if (!(memo instanceof HTMLTextAreaElement) || !(sendButton instanceof HTMLButtonElement) || typeof viewId !== 'string' || viewId.length === 0) {
		return;
	}

	let currentRevision = -1;
	let history = [];
	let isApplyingState = false;
	let isComposing = false;
	let isNavigatingHistory = false;
	let historyCursor = 0;
	let draftValue = '';

	sendButton.addEventListener('click', sendToExtension);
	memo.addEventListener('focus', notifyFocusChanged);
	memo.addEventListener('compositionstart', function () {
		isComposing = true;
	});
	memo.addEventListener('compositionend', function () {
		isComposing = false;
		isNavigatingHistory = false;
		historyCursor = history.length;
		draftValue = memo.value;
		postInputChanged();
		notifySelectionChanged();
	});
	memo.addEventListener('input', function () {
		if (isApplyingState) {
			return;
		}

		isNavigatingHistory = false;
		historyCursor = history.length;
		draftValue = memo.value;
		if (isComposing) {
			return;
		}

		postInputChanged();
	});

	memo.addEventListener('select', notifySelectionChanged);
	memo.addEventListener('click', notifySelectionChanged);
	memo.addEventListener('keydown', function (event) {
		if (event.isComposing) {
			return;
		}

		if (event.key === 'ArrowUp' && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			moveHistory(-1);
			return;
		}

		if (event.key === 'ArrowDown' && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			moveHistory(1);
			return;
		}

		if (event.code === 'KeyH' && event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({
				type: 'openHistory',
				viewId: viewId
			});
			return;
		}

		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			sendToExtension();
			return;
		}
	});

	memo.addEventListener('keyup', function (event) {
		if (event.isComposing || isComposing) {
			return;
		}

		notifySelectionChanged();
	});

	window.addEventListener('message', function (event) {
		const message = event.data;
		if (!isStateMessage(message)) {
			return;
		}

		applyState(message.state, message.focus === true, message.sourceViewId);
	});

	vscode.postMessage({
		type: 'ready',
		viewId: viewId,
		legacyHistory: loadLegacyHistory()
	});

	function sendToExtension() {
		vscode.postMessage({
			type: 'send',
			viewId: viewId,
			text: memo.value
		});
	}

	function postInputChanged() {
		vscode.postMessage({
			type: 'inputChanged',
			viewId: viewId,
			text: memo.value,
			selectionStart: getSelectionStart(),
			selectionEnd: getSelectionEnd()
		});
	}

	function notifySelectionChanged() {
		if (isApplyingState || isComposing) {
			return;
		}

		vscode.postMessage({
			type: 'selectionChanged',
			viewId: viewId,
			selectionStart: getSelectionStart(),
			selectionEnd: getSelectionEnd()
		});
	}

	function notifyFocusChanged() {
		if (isApplyingState) {
			return;
		}

		vscode.postMessage({
			type: 'focusChanged',
			viewId: viewId
		});
	}

	function moveHistory(direction) {
		if (history.length === 0) {
			return;
		}

		if (!isNavigatingHistory) {
			isNavigatingHistory = true;
			historyCursor = history.length;
			draftValue = memo.value;
		}

		if (direction < 0) {
			if (historyCursor > 0) {
				historyCursor -= 1;
			}
		} else if (historyCursor < history.length) {
			historyCursor += 1;
		}

		if (historyCursor >= history.length) {
			isNavigatingHistory = false;
			memo.value = draftValue;
			moveCaretToEnd();
			postInputChanged();
			return;
		}

		memo.value = history[historyCursor];
		moveCaretToEnd();
		postInputChanged();
	}

	function applyState(state, shouldFocus, sourceViewId) {
		if (state.revision < currentRevision) {
			return;
		}

		if (sourceViewId === viewId && shouldFocus !== true) {
			currentRevision = state.revision;
			history = state.history.slice();
			return;
		}

		currentRevision = state.revision;
		history = state.history.slice();

		const preserveHistoryNavigation = isNavigatingHistory === true && sourceViewId === viewId;
		if (!preserveHistoryNavigation) {
			isNavigatingHistory = false;
			historyCursor = history.length;
			draftValue = state.draft;
		}

		const selection = clampSelection(state.draft, state.selectionStart, state.selectionEnd);

		isApplyingState = true;
		try {
			if (memo.value !== state.draft) {
				memo.value = state.draft;
			}

			memo.setSelectionRange(selection.start, selection.end);
			if (shouldFocus) {
				memo.focus();
			}
		} finally {
			isApplyingState = false;
		}
	}

	function getSelectionStart() {
		return typeof memo.selectionStart === 'number' ? memo.selectionStart : 0;
	}

	function getSelectionEnd() {
		return typeof memo.selectionEnd === 'number' ? memo.selectionEnd : getSelectionStart();
	}

	function moveCaretToEnd() {
		const end = memo.value.length;
		memo.setSelectionRange(end, end);
		memo.focus();
	}

	function clampSelection(text, selectionStart, selectionEnd) {
		const maxIndex = text.length;
		const start = clampNumber(selectionStart, 0, maxIndex);
		const end = clampNumber(selectionEnd, start, maxIndex);
		return { start: start, end: end };
	}

	function clampNumber(value, min, max) {
		if (!Number.isFinite(value)) {
			return min;
		}

		return Math.min(Math.max(Math.trunc(value), min), max);
	}

	function isStateMessage(message) {
		return Boolean(
			message &&
			(message.type === 'hydrate' || message.type === 'stateChanged') &&
			isStatePayload(message.state) &&
			typeof message.focus === 'boolean' &&
			(message.sourceViewId === undefined || typeof message.sourceViewId === 'string')
		);
	}

	function isStatePayload(state) {
		return Boolean(
			state &&
			typeof state.draft === 'string' &&
			typeof state.selectionStart === 'number' &&
			typeof state.selectionEnd === 'number' &&
			typeof state.revision === 'number' &&
			Array.isArray(state.history) &&
			state.history.every(function (item) {
				return typeof item === 'string';
			})
		);
	}

	function loadLegacyHistory() {
		try {
			const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
			if (!raw) {
				return [];
			}

			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}

			return parsed.filter(function (item) {
				return typeof item === 'string';
			});
		} catch (_error) {
			return [];
		}
	}
})();
