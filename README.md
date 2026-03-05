# Memo2Terminal MVP

Explorer와 Source Control 영역에 같은 메모장(`textarea`)을 띄우고, 내용을 터미널로 전송하는 최소 확장입니다.

## 기능

- Explorer와 Source Control 영역에 `Memo2Terminal` 뷰 표시
- 메모 입력 후 `Ctrl+Enter`(macOS는 `Cmd+Enter`) 또는 버튼 클릭으로 터미널 전송
- 전송 후 입력창 자동 비움 + 포커스 유지
- 활성 터미널이 없으면 `Memo2Terminal` 터미널 생성 후 전송
- 최근 전송 텍스트 히스토리 최대 15개 공용 보관(`workspaceState`)
- 두 뷰 사이에서 메모 초안, 히스토리, 커서 선택 범위 즉시 동기화
- `Cmd+↑/↓` 히스토리 순회
- `Cmd+Ctrl+H` 히스토리 목록(Quick Pick) 열기

## 실행

```bash
npm install
npm run compile
```

그 다음 `F5`로 Extension Development Host를 실행하세요.

## 사용 팁

- Explorer나 Source Control 어느 쪽에서 입력해도 같은 메모가 즉시 반영됩니다.
- 사이드바 `Memo2Terminal`에서 입력 후 전송하면 바로 다음 입력을 이어서 작성할 수 있습니다.
- 히스토리는 확장 개발 호스트를 재실행해도 유지됩니다.
