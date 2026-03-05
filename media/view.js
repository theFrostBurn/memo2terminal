(function () {
	const vscode = acquireVsCodeApi();
	const memo = document.getElementById('memo');
	const sendButton = document.getElementById('sendButton');
	const HISTORY_KEY = 'memo2terminal.history.v1';
	const HISTORY_LIMIT = 15;

	if (!(memo instanceof HTMLTextAreaElement) || !(sendButton instanceof HTMLButtonElement)) {
		return;
	}

	let history = loadHistory();
	let isNavigatingHistory = false;
	let historyCursor = history.length;
	let draftValue = '';

	function sendToExtension() {
		vscode.postMessage({
			type: 'send',
			text: memo.value
		});
	}

	sendButton.addEventListener('click', sendToExtension);
	memo.addEventListener('keydown', function (event) {
		if (event.key === 'ArrowUp' && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			moveHistory(-1);
			return;
		}

		if (event.key === 'ArrowDown' && event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			moveHistory(1);
			return;
		}

		if (event.code === 'KeyH' && event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			vscode.postMessage({
				type: 'openHistory',
				history: history
			});
			return;
		}

		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			sendToExtension();
		}
	});

	memo.addEventListener('input', function () {
		if (!isNavigatingHistory) {
			return;
		}

		isNavigatingHistory = false;
		historyCursor = history.length;
		draftValue = memo.value;
	});

	window.addEventListener('message', function (event) {
		const message = event.data;
		if (!message) {
			return;
		}

		if (message.type === 'sent' && message.ok === true && typeof message.text === 'string') {
			pushHistory(message.text);
			memo.value = '';
			memo.focus();
			return;
		}

		if (message.type === 'historySelected' && typeof message.text === 'string') {
			memo.value = message.text;
			moveCaretToEnd();
			isNavigatingHistory = false;
			historyCursor = history.length;
			draftValue = memo.value;
		}
	});

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
			return;
		}

		memo.value = history[historyCursor];
		moveCaretToEnd();
	}

	function pushHistory(text) {
		if (typeof text !== 'string') {
			return;
		}

		const normalized = text.trim();
		if (normalized.length === 0) {
			return;
		}

		if (history.length > 0 && history[history.length - 1] === text) {
			resetNavigation();
			return;
		}

		history.push(text);
		if (history.length > HISTORY_LIMIT) {
			history = history.slice(history.length - HISTORY_LIMIT);
		}

		saveHistory(history);
		resetNavigation();
	}

	function resetNavigation() {
		isNavigatingHistory = false;
		historyCursor = history.length;
		draftValue = '';
	}

	function moveCaretToEnd() {
		const end = memo.value.length;
		memo.setSelectionRange(end, end);
		memo.focus();
	}

	function loadHistory() {
		try {
			const raw = localStorage.getItem(HISTORY_KEY);
			if (!raw) {
				return [];
			}

			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}

			return parsed.filter(function (item) {
				return typeof item === 'string';
			}).slice(-HISTORY_LIMIT);
		} catch (_error) {
			return [];
		}
	}

	function saveHistory(nextHistory) {
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory.slice(-HISTORY_LIMIT)));
		} catch (_error) {
			// ignore storage quota/runtime errors
		}
	}
})();
