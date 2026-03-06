# Memo2Terminal MVP

Explorer와 Source Control 영역에 같은 메모장(`textarea`)을 띄우고, 내용을 터미널로 전송하는 최소 확장입니다.

## 기능

- Explorer와 Source Control 영역에 `Memo to Terminal` 뷰 표시
- 메모 입력 후 `Ctrl+Enter`(macOS는 `Cmd+Enter`) 또는 버튼 클릭으로 터미널 전송
- 전송 후 입력창 자동 비움 + 포커스 유지
- 활성 터미널이 없으면 `Memo2Terminal` 터미널 생성 후 전송
- 최근 전송 텍스트 히스토리 최대 15개 공용 보관(`workspaceState`)
- 두 뷰 사이에서 메모 초안, 히스토리, 커서 선택 범위 즉시 동기화
- `@` 입력 시 워크스페이스 파일 선택 후 `@relative/path` 태그 삽입
- `Cmd+↑/↓` 히스토리 순환
- `Cmd+Ctrl+H` 히스토리 목록(Quick Pick) 열기

## 실행

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
- Cursor에서 해당 메뉴가 보이지 않으면 명령 팔레트에서 `Extensions: Install from VSIX...`를 직접 실행해 설치하면 됩니다.
- 수정이 생기면 소스를 고친 뒤 다시 패키징해서 새 `.vsix`를 재설치하면 됩니다.

## 사용 팁

- Explorer나 Source Control 어느 쪽에서 입력해도 같은 메모가 즉시 반영됩니다.
- 사이드바 `Memo to Terminal`에서 입력 후 전송하면 바로 다음 입력을 이어서 작성할 수 있습니다.
- 히스토리는 확장 개발 호스트를 재실행해도 유지됩니다.
- 공백 뒤에서 `@`를 입력하면 파일 선택기가 열리고, 선택한 파일이 `@경로` 형태로 메모에 들어갑니다.
- `@file` 선택기에서는 `.venv`, `node_modules`, `dist` 같은 공통 생성 디렉터리는 기본적으로 숨깁니다.
- 현재 에디터에서 열어둔 파일은 `@file` 선택기 상단에 우선 표시됩니다.
- `@file` 선택기를 취소해도 메모 입력창 포커스는 유지됩니다.
