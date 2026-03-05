# Explorer + SCM 이중 뷰 설계

## 목표

`Memo2Terminal`을 Explorer와 Source Control 양쪽에 동시에 둘 수 있게 만들되, 사용자가 두 뷰를 별개의 기능으로 느끼지 않게 합니다.

- `memo2terminal.view`
- `memo2terminal.scmView`

두 뷰는 표시 위치만 다르고, 실제 상태는 확장 호스트의 단일 store가 소유합니다.

## 핵심 원칙

### 1. 상태의 단일 소유권

상태는 Webview가 아니라 extension host가 소유합니다.

- 현재 메모 텍스트
- 커서/선택 범위
- 최근 전송 히스토리
- 마지막으로 활성화된 뷰
- 포커스 복원 의도
- 상태 revision

Webview는 입력과 표시만 담당하는 얇은 클라이언트가 됩니다.

### 2. Webview는 항상 재수화 가능해야 함

뷰가 숨겨지거나 다시 열려도 문제없도록, 각 Webview는 언제든 store snapshot 하나로 복구 가능해야 합니다.

`retainContextWhenHidden`은 체감 품질을 높이는 옵션으로만 사용하고, 정합성은 store 재수화로 보장합니다.

### 3. 즉시 반영은 "라이브 뷰끼리만"

실제로 살아 있는 Webview끼리는 `postMessage`로 즉시 동기화합니다.

숨겨진 뷰나 아직 resolve되지 않은 뷰에 대해서는 메시지 전달을 보장 대상으로 보지 않습니다. 그런 경우에는 다음 활성화 시 snapshot을 다시 내려줍니다.

## 매니페스트 설계

`package.json`의 `contributes.views`를 두 군데로 나눕니다.

```json
{
  "contributes": {
    "views": {
      "explorer": [
        {
          "id": "memo2terminal.view",
          "name": "Memo2Terminal",
          "type": "webview"
        }
      ],
      "scm": [
        {
          "id": "memo2terminal.scmView",
          "name": "Memo2Terminal",
          "type": "webview"
        }
      ]
    }
  }
}
```

기존 Explorer 뷰 id인 `memo2terminal.view`는 유지합니다.

이유:

- 기존 Explorer 웹뷰의 저장 상태와 사용자 뷰 위치를 최대한 보존하기 위함
- 기존 `localStorage` 히스토리 마이그레이션 경로를 살리기 위함

## 확장 구조

### 1. `MemoStore`

확장 호스트 메모리 안의 단일 상태 저장소입니다.

- `draft: string`
- `selectionStart: number`
- `selectionEnd: number`
- `history: string[]`
- `lastActiveViewId: string | undefined`
- `focusWanted: boolean`
- `revision: number`

역할:

- 상태 갱신
- revision 증가
- snapshot 제공
- `workspaceState` 영속화

### 2. `MemoViewRegistry`

현재 살아 있는 Webview 인스턴스를 추적합니다.

- `Map<viewId, WebviewView>`
- Explorer 뷰와 SCM 뷰 모두 등록
- dispose 시 자동 해제

역할:

- 브로드캐스트 대상 관리
- 특정 뷰만 갱신
- 마지막 활성 뷰 추적

### 3. `Memo2TerminalViewProvider`

공용 provider 하나를 두고, view id별로 resolve합니다.

- `memo2terminal.view`
- `memo2terminal.scmView`

HTML/CSS/JS는 동일하게 재사용하고, 초기화 payload에 현재 `viewId`만 실어줍니다.

## 메시지 프로토콜

### Webview -> Extension

- `ready`
- `inputChanged`
- `selectionChanged`
- `focusChanged`
- `send`
- `openHistory`

### Extension -> Webview

- `hydrate`
- `stateChanged`
- `sent`
- `historySelected`
- `restoreFocus`

## 동기화 흐름

### 1. 최초 로드

1. Webview가 `ready` 전송
2. Extension이 현재 snapshot을 `hydrate`로 응답
3. Webview는 textarea 값, 선택 범위, 히스토리 UI를 복구

### 2. 한쪽에서 입력

1. Explorer 또는 SCM 뷰에서 `inputChanged`
2. `MemoStore`가 `draft`, `selection`, `lastActiveViewId`, `revision` 갱신
3. Extension이 현재 살아 있는 다른 뷰에 `stateChanged` 브로드캐스트
4. 다른 뷰는 내용을 즉시 반영

### 3. 한쪽에서 전송

1. `send`
2. Extension이 터미널 전송 수행
3. `history` 갱신, `draft` 비움, `focusWanted` 설정, `revision` 증가
4. 살아 있는 두 뷰 모두에 `sent` 또는 `stateChanged` 반영

### 4. 숨겨진 뷰 복귀

1. 사용자가 Explorer/SCM으로 이동
2. 해당 Webview가 이미 살아 있으면 최신 상태 유지
3. 살아 있지 않다면 `ready -> hydrate`로 완전 복구

## 포커스/선택 범위 복원

체감상 "하나의 메모장"처럼 느끼게 하려면 텍스트만 맞추면 부족합니다.

따라서 아래를 같이 저장합니다.

- `selectionStart`
- `selectionEnd`
- 마지막 활성 뷰 id
- 전송 직후 다시 포커스할지 여부

복원 규칙:

- 사용자가 방금 입력한 뷰가 마지막 활성 뷰면 그 뷰가 우선권을 가짐
- 다른 뷰는 값은 즉시 따라가되, 포커스를 강제로 뺏지 않음
- 전송 직후에는 마지막 활성 뷰만 포커스 복원

## 히스토리 저장 전략

현재는 Webview `localStorage`에 히스토리를 보관합니다. 2안에서는 이 구조를 버립니다.

이유:

- Explorer와 SCM 뷰가 각각 따로 저장하면 동기화 기준점이 애매해짐
- 뷰별로 기록이 갈라질 수 있음
- 숨김/재생성 시점마다 일관성이 깨질 수 있음

대신 extension host의 `workspaceState`를 공용 저장소로 사용합니다.

Explorer 웹뷰가 예전에 저장해둔 `localStorage` 히스토리가 있다면, 최초 `ready` 시점에 공용 store로 한 번 이관합니다.

권장 키:

- `memo2terminal.draft`
- `memo2terminal.history`
- `memo2terminal.selection`
- `memo2terminal.lastActiveViewId`

## 충돌 처리

두 뷰를 동시에 띄워놓고 양쪽에서 매우 빠르게 입력할 수 있습니다.

초기 설계에서는 단순한 마지막 입력 우선 정책으로 충분합니다.

- 각 변경에 `revision` 부여
- 늦게 온 revision이 최신 상태
- Webview는 자신보다 오래된 revision 패치는 무시

고급 충돌 해결은 필요 없습니다. 메모장 성격상 last-write-wins로 충분합니다.

## UX 세부 정책

- 두 뷰의 UI는 완전히 동일하게 유지
- 뷰 제목은 둘 다 `Memo2Terminal`
- 안내 문구는 위치별로 달리하지 않음
- 사용자는 어느 쪽을 열어도 같은 메모를 보고 있다고 느껴야 함

예외:

- 포커스 복원은 현재 사용자가 만지고 있던 뷰에만 적용

## 구현 단계

### 단계 1

두 view id를 매니페스트에 추가하고, 공용 provider가 두 뷰를 등록하도록 변경합니다.

### 단계 2

Webview `localStorage` 상태를 extension host store로 이동합니다.

### 단계 3

입력/선택 범위/히스토리 동기화를 `postMessage` 기반으로 추가합니다.

### 단계 4

포커스 복원과 revision 기반 충돌 방지를 보강합니다.

## 테스트 시나리오

- Explorer 뷰만 켜고 입력 후 전송
- SCM 뷰만 켜고 입력 후 전송
- 두 뷰를 동시에 열고 Explorer에서 입력하면 SCM이 즉시 따라오는지 확인
- 두 뷰를 동시에 열고 SCM에서 전송하면 Explorer가 비워지는지 확인
- 한 뷰를 숨긴 상태에서 다른 쪽을 수정한 뒤 다시 열었을 때 최신 상태로 복원되는지 확인
- 개발 호스트 재시작 후 히스토리와 draft가 유지되는지 확인

## 모카 권장 구현 포인트

가장 중요한 것은 "뷰를 두 개 만드는 것"이 아니라 "상태를 Webview 밖으로 빼는 것"입니다.

지금 구조에서 먼저 바꿔야 하는 부분은 아래 두 가지입니다.

- `localStorage` 기반 히스토리 제거
- Webview 단독 상태 관리 제거

이 두 가지를 먼저 정리하지 않으면 Explorer와 SCM을 붙여도 결국 겉보기만 이중 뷰이고, 실제로는 각자 따로 노는 구조가 됩니다.
