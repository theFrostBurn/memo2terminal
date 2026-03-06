# Memo2Terminal

Claude Code CLI나 Codex CLI를 사용할 때, 터미널의 제한적인 편집 경험을 보완하기 위해 만든 확장입니다.
VS Code 또는 Cursor의 Explorer와 Source Control 영역에 메모 공간(`textarea`)을 띄우고, 작성한 내용을 터미널로 전송할 수 있습니다.



## 기능

- Explorer와 Source Control 영역에 `Memo to Terminal` 뷰 표시
- 메모 입력 후 `Ctrl + Enter`(macOS는 `Cmd + Enter`) 또는 버튼 클릭으로 터미널로 전송
- 전송 후 입력창 자동 비움 + 포커스 유지
- 활성 터미널이 없으면 `Memo2Terminal` 터미널 생성 후 전송
- 최근 전송 텍스트 히스토리 최대 15개 공용 보관(`workspaceState`)
- 두 뷰 사이에서 메모 초안, 히스토리, 커서 선택 범위 즉시 동기화
- macOS: `Cmd + ↑/↓` 히스토리 순환, `Cmd + Ctrl + H` 히스토리 목록(Quick Pick)
- Windows/Linux: `Ctrl + ↑/↓` 히스토리 순환, `Ctrl + H` 히스토리 목록(Quick Pick)
- `@` 입력 시 Quick Pick이 열리고 파일을 선택할 수 있으며, 선택한 파일은 `@경로` 형태로 메모에 삽입됩니다.



## 개발 및 테스트 실행

```bash
npm install
npm run compile
```

그 다음 `F5`로 Extension Development Host를 실행하세요.



## VSIX 패키징 및 설치

실사용으로 설치하려면 `VSIX` 패키지로 묶어서 현재 IDE에 설치하면 됩니다.

```bash
npx @vscode/vsce package
```

- `package.json`의 `vscode:prepublish` 설정으로 패키징 전에 `npm run compile`이 자동 실행됩니다.
- 패키징이 끝나면 프로젝트 루트에 `.vsix` 파일이 생성됩니다.
- VS Code 또는 Cursor에서 확장 메뉴의 `...`에서 `Install from VSIX...`를 선택해 설치하면 됩니다.
- 해당 메뉴가 보이지 않으면 명령 팔레트를 열고 `Extensions: Install from VSIX...`를 실행해 설치하면 됩니다.
- 수정이 생기면 소스를 고친 뒤 다시 패키징해서 새 `.vsix`를 재설치하면 됩니다.



## 기타

- Explorer나 Source Control 어느 쪽에서 입력해도 같은 메모가 다른 쪽에 즉시 반영됩니다.
- 히스토리는 확장 개발 호스트를 재실행해도 유지됩니다.
- 공백 뒤에서 `@`를 입력하면 파일 선택기가 열리고, 선택한 파일이 `@경로` 형태로 메모에 들어갑니다.
- `@file` 선택기에서는 `.venv`, `node_modules`, `dist` 같은 공통 생성 디렉터리는 기본적으로 숨깁니다.
- 현재 에디터에서 열어둔 파일은 `@file` 선택기 상단에 우선 표시됩니다.
- `@file` 선택기를 취소해도 메모 입력창 포커스는 유지됩니다.



## 단축키 사용자 설정

- Settings에서 `Memo2Terminal` 또는 `memo2terminal.shortcuts`를 검색하면 전송, 히스토리 이전/다음, 히스토리 목록 단축키를 각각 바꿀 수 있습니다.
- 설정 화면은 `Cmd + ,`(Windows/Linux는 `Ctrl + ,`)로 열 수 있고, 명령 팔레트에서 `Preferences: Open Settings (UI)`를 실행해도 됩니다.
- 설정을 비워두면 운영체제별 기본값을 사용합니다.
- 설정을 저장하면 열린 `Memo to Terminal` 뷰의 실제 단축키, placeholder, 힌트 텍스트가 즉시 함께 바뀝니다.
- 입력 형식 예: `Ctrl+Enter`, `Cmd+ArrowUp`, `Ctrl+ArrowDown`, `Cmd+Ctrl+H`

설정 키는 아래 네 가지입니다.

- `memo2terminal.shortcuts.send`: 메모 전송
- `memo2terminal.shortcuts.historyPrevious`: 이전 히스토리
- `memo2terminal.shortcuts.historyNext`: 다음 히스토리
- `memo2terminal.shortcuts.historyList`: 히스토리 목록 열기

예를 들어 아래처럼 설정할 수 있습니다.

```json
{
  "memo2terminal.shortcuts.send": "Ctrl+Enter",
  "memo2terminal.shortcuts.historyPrevious": "Ctrl+ArrowUp",
  "memo2terminal.shortcuts.historyNext": "Cmd+ArrowDown",
  "memo2terminal.shortcuts.historyList": "Cmd+Ctrl+H"
}
```

지원하는 키 입력 예시는 아래와 같습니다.

- 수정 키: `Cmd`, `Command`, `Meta`, `Ctrl`, `Control`, `Alt`, `Option`, `Shift`
- 일반 키: `Enter`, `ArrowUp`, `ArrowDown`, `Up`, `Down`, `↑`, `↓`, `Tab`, `Esc`, `Escape`, `Backspace`, `Space`, 알파벳 한 글자, 숫자 한 글자
- 잘못된 형식이 들어오면 해당 항목만 자동으로 기본값으로 돌아갑니다.