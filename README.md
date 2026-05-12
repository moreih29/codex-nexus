[npm](https://www.npmjs.com/package/codex-nexus) · [라이선스](./LICENSE) · [English](./README.en.md)

# codex-nexus

`codex-nexus`는 [`@moreih29/nexus-core`](https://github.com/moreih29/nexus-core)를 Codex에서 바로 쓰기 쉽게 설치해 주는 플러그인 패키지다.

설치가 끝나면 다음이 자동으로 연결된다.

- Lead 메인 지시 파일
- Nexus 전용 하위 에이전트
- `nx` MCP 서버
- Nexus 태그용 Codex 훅 정의(Codex v0.129+에서는 trust opt-in 필요)
- Codex가 읽는 스킬 디렉터리

## 무엇을 할 수 있나

설치와 hook trust가 끝나면 Codex에서 이런 흐름을 바로 쓸 수 있다.

- `[plan]` 구현 전에 의사결정 정리
- `[auto-plan]` Lead가 자동으로 계획 정리
- `[run]` 계획을 태스크로 실행
- `[m]` 메모 저장
- `[m:gc]` 메모 정리
- `[d]` 현재 plan 안건의 결정 기록

## Codex 호환성

현재 릴리스는 **Codex CLI v0.129 이상**을 대상으로 한다. Codex v0.129의 canonical hook feature와 trust model에 맞춰 설치하며, 이전 Codex용 fallback은 현재 동작으로 지원하지 않는다.

- fresh install은 `[features].hooks = true`를 쓴다.
- fresh install은 `[features].codex_hooks`를 쓰지 않는다.
- `codex_hooks`는 예전 codex-nexus 설치본을 정리하거나 사용자가 직접 넣은 값을 보존하는 migration/history 맥락에서만 다룬다.

## 빠른 설치

가장 일반적인 설치는 user scope다.

```bash
npx -y codex-nexus install
```

TTY 환경에서는 설치 중에:

1. 설치 범위 `user` 또는 `project`
2. 설치된 codex-nexus hook을 `hooks.state`에 신뢰할지 여부
3. 설치 완료 후 모델 설정을 바로 진행할지 여부

를 고를 수 있다.

기본 설치는 hook 정의만 쓰고 trust state는 쓰지 않는다. 비대화형으로 바로 신뢰까지 기록하려면 명시적으로 `--trust-hooks`를 사용한다.

```bash
npx -y codex-nexus install --trust-hooks
```

설치되는 버전은 항상 현재 실행 중인 `codex-nexus` 버전이다.
즉, 버전을 바꾸고 싶다면 installer 안에서 고르는 것이 아니라 실행할 패키지 버전을 바꿔야 한다.

## CLI 커맨드

```bash
codex-nexus install [--scope user|project]
codex-nexus install [--scope user|project] --trust-hooks
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
TTY에서 `install`을 실행하면 설치 완료 후 이 모델 설정 흐름으로 바로 이어갈지도 물어본다.

```bash
npx -y codex-nexus models --scope project
npx -y codex-nexus models --scope project --targets default,engineer,tester --model gpt-5.4
npx -y codex-nexus models --scope project --targets engineer,tester --model inherit
```

- TTY에서는 scope, 대상, 모델을 순서대로 고른다. scope 기본 선택값은 `project`다.
- 비대화형 direct mode에서는 `--targets`와 `--model`을 함께 쓴다.
- 모델 선택지에는 `inherit`도 포함된다. direct mode에서는 `--model inherit`을 사용한다.
- `--agents`는 `--targets`의 alias로 지원한다.
- 현재 지원되는 대상은 `default`, `architect`, `designer`, `postdoc`, `engineer`, `researcher`, `writer`, `reviewer`, `tester`, `all`이다.
- `all`은 `default`와 현재 지원되는 non-lead 하위 에이전트만 포함한다.
- `default`는 scoped `.codex/config.toml`의 top-level `model`을 설정한다.
- 하위 에이전트 대상은 scoped `.codex/agents/<agent>.toml`의 top-level `model`을 설정한다.
- `inherit`을 선택하면 해당 대상 TOML의 top-level `model` 필드를 제거한다. 하위 에이전트는 scoped `.codex/config.toml`의 top-level 모델을 상속한다.
- `lead`는 설정 대상에서 제외된다.

기본 설치 상태의 하위 에이전트 TOML에는 `model` 필드를 쓰지 않는다.
따라서 별도 override를 설정하지 않은 에이전트는 scoped `.codex/config.toml`의 top-level 모델을 상속한다.

선택한 값은 scoped `.codex/.codex-nexus/model-overrides.json`에도 저장되어, 이후 `codex-nexus install`을 다시 실행해도 현재 지원되는 target model override가 다시 적용된다.

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

- Lead 지시를 `developer_instructions`에 인라인으로 기록
- `[features].multi_agent = true`
- `[features].child_agents_md = true`
- `[features].hooks = true`
- `[mcp_servers.nx]`
- Codex v0.129+ inline hook wiring (`config.toml` `[hooks]`)
- hook 정의만 기본으로 설치하고, opt-in 전에는 `hooks.state` trust entry를 쓰지 않음
- `.codex/agents/*` (Nexus custom subagent)
- `.agents/skills/*`
- marketplace entry
- native hook surface 준비용 plugin manifest 항목 (`hooks: "./hooks.json"`)

즉, 플러그인만 복사하는 것이 아니라 Codex가 실제로 읽는 최종 사용자 경로까지 함께 정리한다.
또한 `nx` MCP는 `npx` PATH에 의존하지 않도록, 설치된 런타임과 설치된 `nexus-core` server.js 절대경로로 연결한다.
반면 설치된 plugin bundle 내부의 `agents/*.toml`은 배포 소스 형태(`nexus-mcp`)를 유지하고, 실제 실행용 agent 사본은 `.codex/agents/*` 쪽에 절대경로 launcher로 써 넣는다.

## Codex v0.129+ 훅과 신뢰 모델

`codex-nexus`는 Codex CLI v0.129 이상을 기준으로 **canonical `[features].hooks` + inline `config.toml` `[hooks]`** 표면을 사용한다. fresh install은 `[features].codex_hooks`를 쓰지 않고, 예전 Codex용 `.codex/hooks.json` fallback을 현재 동작으로 제공하지 않는다.

업데이트 / migration 원칙:

- 예전 codex-nexus가 관리 상태로 남긴 `[features].codex_hooks = true`는 `[features].hooks = true`로 정리된다.
- 사용자가 직접 소유한 `codex_hooks` 값은 migration과 uninstall 보존을 위해 그대로 둔다.
- `.codex/hooks.json`에 남아 있던 codex-nexus managed hook은 inline `[hooks]`로 옮겨지거나 제거되며, 사용자 소유 hook은 보존한다.

신뢰 모델:

- 기본 `install`은 hook 정의만 쓴다. `hooks.state` trust entry는 자동으로 쓰지 않는다.
- TTY에서는 설치 후 “Trust installed codex-nexus hooks...” 프롬프트를 수락해야 trust entry를 쓴다.
- 비대화형 설치에서는 `codex-nexus install --trust-hooks`를 명시해야 trust entry를 쓴다.
- `project` scope 설치라도 trust entry는 현재 사용자 Codex config(`~/.codex/config.toml` 기준)에 기록된다. project config에는 `hooks.state`를 쓰지 않는다.

`doctor`는 v0.129 trust/runability 상태를 점검한다.

- `[features].hooks`가 빠졌거나 꺼진 상태
- codex-nexus hook surface가 빠진 상태
- untrusted hook
- disabled hook state
- trust 후 command/timeout 등이 달라진 modified hook
- native plugin hook source와 direct installer hook source가 동시에 active인 중복 상태

Native plugin hook 표면은 준비되어 있지만 기본 runtime 경로는 여전히 installer가 직접 쓰는 inline hook이다. Plugin manifest에는 `hooks: "./hooks.json"`가 들어 있어 Codex native plugin loader가 hook spec을 찾을 수 있지만, `plugin_hooks`가 default-off/experimental인 동안 이 문서는 native plugin hook runtime이 실사용 검증됐다고 주장하지 않는다. `plugin_hooks`를 켠 상태에서 direct hook도 남아 있으면 중복 실행 위험이 있으므로 `doctor`가 `native/direct hook duplicate`로 보고한다.

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

기본 설치 직후에는 hook 정의가 있어도 trust entry가 없으므로 `doctor`가 `hook trust (... untrusted)`를 보고할 수 있다. 설치와 동시에 신뢰까지 기록하려면 아래처럼 실행한다.

```bash
npx -y codex-nexus install --scope user --trust-hooks
npx -y codex-nexus doctor --scope user
```

명시적 trust 또는 interactive prompt 수락 후 설정이 정상이면 `Doctor passed.`가 나온다.

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

설치와 필요한 hook trust가 끝난 뒤 Codex에서 바로 이렇게 시작하면 된다.

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

- 이 릴리스의 hook 동작은 Codex CLI v0.129 이상을 대상으로 한다. 예전 Codex용 `codex_hooks`/`.codex/hooks.json` fallback은 현재 동작으로 문서화하지 않는다.
- 기본 설치는 hook을 자동 신뢰하지 않는다. `--trust-hooks` 또는 interactive prompt 수락 전에는 `doctor`가 untrusted 상태를 보고할 수 있다.
- project scope에서 hook trust를 기록해도 `hooks.state`는 현재 사용자 Codex config에 쓰이며, project config에는 쓰지 않는다.
- `nx` MCP는 `npx`가 아니라 설치 시점 런타임 절대경로를 사용한다.
- project scope 설치 시 `.gitignore`에는 로컬 install artifact 디렉터리용 ignore 항목이 자동으로 추가된다.
- uninstall은 unrelated 설정을 최대한 보존하도록 설계됐지만, metadata가 없는 예전 설치본은 best-effort 정리만 가능하다.

## 저장소 구조

추적되는 publishable source of truth는 `plugins/codex-nexus` 아래에 있다.

- `plugins/codex-nexus/.codex-plugin/plugin.json`

반면 repo root의 `.codex`, `.agents`는 project scope 설치 시 생기는 로컬 산출물이며, 소스로 추적하지 않는다.
최종 사용자는 보통 이 경로를 직접 만질 필요가 없다. 실제 사용은 `codex-nexus install` 기준으로 보면 된다.
