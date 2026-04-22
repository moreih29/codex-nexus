[npm](https://www.npmjs.com/package/codex-nexus) · [라이선스](./LICENSE) · [English](./README.en.md)

# codex-nexus

`codex-nexus`는 [`@moreih29/nexus-core`](https://github.com/moreih29/nexus-core)를 Codex에서 바로 쓰기 쉽게 설치해 주는 플러그인 패키지다.

설치가 끝나면 다음이 자동으로 연결된다.

- Lead 메인 지시 파일
- Nexus 전용 하위 에이전트
- `nx` MCP 서버
- Nexus 태그용 Codex 훅
- Codex가 읽는 스킬 디렉터리

## 무엇을 할 수 있나

설치 후 Codex에서 이런 흐름을 바로 쓸 수 있다.

- `[plan]` 구현 전에 의사결정 정리
- `[auto-plan]` Lead가 자동으로 계획 정리
- `[run]` 계획을 태스크로 실행
- `[m]` 메모 저장
- `[m:gc]` 메모 정리
- `[d]` 현재 plan 안건의 결정 기록

## 빠른 설치

가장 일반적인 설치는 user scope다.

```bash
npx -y codex-nexus install
```

TTY 환경에서는 설치 중에:

1. 설치 범위 `user` 또는 `project`

를 고를 수 있다.

설치되는 버전은 항상 현재 실행 중인 `codex-nexus` 버전이다.
즉, 버전을 바꾸고 싶다면 installer 안에서 고르는 것이 아니라 실행할 패키지 버전을 바꿔야 한다.

## 설치 범위

### user

```bash
npx -y codex-nexus install --scope user
```

여러 저장소에서 공통으로 쓰고 싶을 때 권장한다.

설치 대상:

- `~/.codex`
- `~/.agents`

### project

```bash
npx -y codex-nexus install --scope project
```

현재 저장소에서만 쓰고 싶을 때 사용한다.

설치 대상:

- `<repo>/.codex`
- `<repo>/.agents`
- `<repo>/plugins/codex-nexus`

## 설치 후 무엇이 생기나

installer는 선택한 버전을 기준으로 아래를 맞춰 준다.

- `model_instructions_file = "lead.instructions.md"`
- `[features].multi_agent = true`
- `[features].child_agents_md = true`
- `[features].codex_hooks = true`
- `[mcp_servers.nx]`
- `.codex/hooks.json`
- `.codex/agents/*`
- `.agents/skills/*`
- marketplace entry

즉, 플러그인만 복사하는 것이 아니라 Codex가 실제로 읽는 최종 사용자 경로까지 함께 정리한다.
또한 `nx` MCP는 `npx` PATH에 의존하지 않도록, 설치된 런타임과 설치된 `nexus-core` server.js 절대경로로 연결한다.

## 설치 확인

```bash
npx -y codex-nexus doctor --scope user
npx -y codex-nexus doctor --scope project
```

설치가 정상이면 `Doctor passed.`가 나온다.

## 사용 예시

설치가 끝난 뒤 Codex에서 바로 이렇게 시작하면 된다.

```text
[plan] 인증 플로우를 어떻게 나눌지 정리해줘
```

```text
[run] 방금 정리한 계획대로 구현해줘
```

```text
[m] 이번 장애 대응에서 배운 점 저장
```

## 업데이트

최신 호환 버전으로 다시 설치하면 된다.

```bash
npx -y codex-nexus install --scope user
```

특정 버전으로 설치하고 싶으면:

```bash
npx -y codex-nexus@<version> install --scope user
bunx codex-nexus@<version> install --scope user
```

installer는 현재 실행 중인 `codex-nexus` 버전에 맞춰 `@moreih29/nexus-core` 버전도 함께 맞춘다.

## 주의할 점

- 훅은 Codex의 config-layer `hooks.json`에 병합된다.
- `nx` MCP는 `npx`가 아니라 설치 시점 런타임 절대경로를 사용한다.
- project scope 설치 시 `.gitignore`에는 로컬 install artifact 디렉터리용 ignore 항목이 자동으로 추가된다.

## 저장소 구조

추적되는 publishable source of truth는 `plugins/codex-nexus` 아래에 있다.

- `plugins/codex-nexus/.codex-plugin/plugin.json`

반면 repo root의 `.codex`, `.agents`는 project scope 설치 시 생기는 로컬 산출물이며, 소스로 추적하지 않는다.
최종 사용자는 보통 이 경로를 직접 만질 필요가 없다. 실제 사용은 `codex-nexus install` 기준으로 보면 된다.
