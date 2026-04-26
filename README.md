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

## CLI 커맨드

```bash
codex-nexus install [--scope user|project]
codex-nexus models [--scope user|project]
codex-nexus models [--scope user|project] --targets default,engineer --model gpt-5.4
codex-nexus uninstall [--scope user|project]
codex-nexus doctor [--scope user|project]
codex-nexus version
codex-nexus --version
```

버전 확인 예시:

```bash
npx -y codex-nexus version
npx -y codex-nexus --version
```

## 모델 선택

설치 후 Codex 기본 모델과 Nexus 하위 에이전트 모델을 scope별로 설정할 수 있다.

```bash
npx -y codex-nexus models --scope project
npx -y codex-nexus models --scope project --targets default,engineer,tester --model gpt-5.4
```

- TTY에서는 scope, 대상, 모델을 순서대로 고른다. scope 기본 선택값은 `project`다.
- 비대화형 direct mode에서는 `--targets`와 `--model`을 함께 쓴다.
- `--agents`는 `--targets`의 alias로 지원한다.
- 대상은 `default`, `architect`, `designer`, `postdoc`, `strategist`, `engineer`, `researcher`, `writer`, `reviewer`, `tester`, `all`이다.
- `default`는 scoped `.codex/config.toml`의 top-level `model`을 설정한다.
- 하위 에이전트 대상은 scoped `.codex/agents/<agent>.toml`의 top-level `model`을 설정한다.
- `lead`는 설정 대상에서 제외된다.

선택한 값은 scoped `.codex/.codex-nexus/model-overrides.json`에도 저장되어, 이후 `codex-nexus install`을 다시 실행해도 non-lead agent model override가 다시 적용된다.

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
- Codex hook wiring (`config.toml` inline `[hooks]` 또는 `.codex/hooks.json`)
- `.codex/agents/*`
- `.agents/skills/*`
- marketplace entry

즉, 플러그인만 복사하는 것이 아니라 Codex가 실제로 읽는 최종 사용자 경로까지 함께 정리한다.
또한 `nx` MCP는 `npx` PATH에 의존하지 않도록, 설치된 런타임과 설치된 `nexus-core` server.js 절대경로로 연결한다.
반면 설치된 plugin bundle 내부의 `agents/*.toml`은 배포 소스 형태(`nexus-mcp`)를 유지하고, 실제 실행용 agent 사본은 `.codex/agents/*` 쪽에 절대경로 launcher로 써 넣는다.

## 훅 호환성

`codex-nexus`는 **자신이 관리하는 Codex hook** 을 `.codex/` 레이어마다 정확히 한 표면에만 쓴다. install/update를 다시 실행해도 같은 managed hook을 inline `[hooks]` 와 `.codex/hooks.json` 양쪽에 중복으로 쓰지 않는다.

선택 규칙은 보수적이다.

- 이미 `config.toml` 안에 inline `[hooks]`가 있으면 그 표면을 유지한다.
- inline `[hooks]`가 없고 이미 `.codex/hooks.json`이 있으면 legacy 표면을 유지한다.
- 둘 다 없다면 `codex --version`이 `0.124.0` 이상일 때만 `config.toml` inline `[hooks]`를 사용한다.
- Codex 버전을 확인할 수 없거나 `0.124.0` 미만이면 `.codex/hooks.json`으로 fallback한다.

관리되는 matcher / runtime 범위:

- `PreToolUse`, `PermissionRequest` matcher는 `Bash`, `apply_patch` / `Edit` / `Write`, `mcp__.*`를 커버한다.
- hook runtime은 Bash, `apply_patch`, MCP 이벤트 입력을 정규화한다.
- 기존 Bash deny 규칙은 계속 Bash command에만 적용된다.
- `PostToolUse`는 의도적으로 변경하지 않는다.

## uninstall

설치 후 되돌리고 싶으면 같은 scope로 uninstall 하면 된다.

```bash
npx -y codex-nexus uninstall --scope user
npx -y codex-nexus uninstall --scope project
```

동작 원칙:

- codex-nexus가 관리한 파일/설정만 되돌리거나 제거하려고 시도한다.
- 다른 플러그인이나 사용자가 넣은 hook / marketplace / config 값은 최대한 유지한다.
- 새 설치부터는 rollback metadata를 저장해서 더 정확하게 복구한다.
- 예전 설치본처럼 metadata가 없으면 conservative best-effort 방식으로 정리한다.

즉, 완전한 파일 전체 롤백보다는 **codex-nexus가 건드린 표면만 복원/제거**하는 쪽에 맞춰져 있다.

## 설치 확인

```bash
npx -y codex-nexus doctor --scope user
npx -y codex-nexus doctor --scope project
```

설치가 정상이면 `Doctor passed.`가 나온다.

## cmux 알림

`codex-nexus`는 Codex hook을 통해 cmux 상태/알림도 best-effort로 제공한다.

전제 조건:

- Codex가 cmux 안에서 실행 중이어야 한다 (`CMUX_WORKSPACE_ID` 환경변수 존재)
- `cmux` CLI가 PATH에 있어야 한다

동작:

- 작업 시작 / Bash 실행 시 `Running` 상태 pill 갱신
- 응답 완료 시 `Response ready` 알림 + `Needs Input` 상태 pill
- 권한 요청 시 `Permission requested` 알림 + `Needs Input` 상태 pill

표시값은 기본적으로 아래를 사용한다.

- icon: `bolt` / `bell`
- status: `Running` / `Needs Input`
- color: `#007AFF`

원하면 비활성화할 수 있다.

```bash
CODEX_NEXUS_CMUX=0 codex
# 또는
CODEX_NEXUS_CMUX=false codex
```

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

- codex-nexus가 관리하는 hook은 보수적 표면 선택 규칙을 따른다. 기존 inline 표면이 있으면 inline을 유지하고, inline이 없을 때 기존 `hooks.json`은 legacy를 유지하며, 아무 표면도 없을 때만 지원되는 Codex에서 `config.toml` inline `[hooks]`를 새로 사용한다.
- `nx` MCP는 `npx`가 아니라 설치 시점 런타임 절대경로를 사용한다.
- project scope 설치 시 `.gitignore`에는 로컬 install artifact 디렉터리용 ignore 항목이 자동으로 추가된다.
- uninstall은 unrelated 설정을 최대한 보존하도록 설계됐지만, metadata가 없는 예전 설치본은 best-effort 정리만 가능하다.

## 저장소 구조

추적되는 publishable source of truth는 `plugins/codex-nexus` 아래에 있다.

- `plugins/codex-nexus/.codex-plugin/plugin.json`

반면 repo root의 `.codex`, `.agents`는 project scope 설치 시 생기는 로컬 산출물이며, 소스로 추적하지 않는다.
최종 사용자는 보통 이 경로를 직접 만질 필요가 없다. 실제 사용은 `codex-nexus install` 기준으로 보면 된다.
