# codex-nexus

[![npm version](https://img.shields.io/npm/v/codex-nexus)](https://www.npmjs.com/package/codex-nexus)

> 🌏 [English](README.en.md)

OpenAI Codex CLI를 위한 Nexus wrapper 플러그인.

`codex-nexus`는 `@moreih29/nexus-core`가 제공하는 Codex `sync` 산출물과 runtime exports를 source of truth로 삼고, 그 위에 Codex 전용 install, config merge, 경로 해석을 얹는 얇은 래퍼입니다. 공통 Nexus 정의, generated Codex outputs, hook/MCP runtime 구현은 `nexus-core`에서 가져오고, `codex-nexus`는 그것을 Codex CLI에 맞게 설치하고 연결합니다.

## Why

- 구현 전에 `[plan]`으로 먼저 정리
- `[run]`에서 태스크 기반으로 실행
- 완료된 specialist subagent를 Codex native resume로 이어서 호출 가능
- `.nexus/`에 프로젝트 지식과 결정 기록 유지
- 역할이 분리된 Codex-native 에이전트 카탈로그 제공
- `nx` MCP 도구로 plan/task/history/artifact 흐름 사용

## Architecture

- `nexus-core` — 공통 Codex 자산과 generated output contract의 source of truth
- `codex-nexus` — Codex-specific wrapper (`install`, config merge, runtime path adaptation)
- `bun run sync:core` — upstream `nexus-core sync --harness=codex`를 staging 경로에 실행한 뒤 managed outputs를 이 repo의 `agents/`, `plugin/`, `prompts/`, `install/`로 반영

## Quick Start

### 1. Install

`codex-nexus`는 npm으로 배포됩니다. CLI entrypoint는 `bun`으로 실행되고, 설치 후 hook/MCP runtime은 `@moreih29/nexus-core` dependency의 prebuilt JS를 사용합니다.

Requirements:

- OpenAI Codex CLI
- `bun` available on `PATH`

```bash
npm install -g codex-nexus
codex-nexus install
```

터미널(TTY)에서 `codex-nexus install`을 실행하면:

- 설치할 패키지 버전
- 설치 대상 scope (`user` / `project`)

를 순서대로 선택할 수 있습니다.

`install`은 core-generated skills/agents를 scope에 맞는 `.codex/` 아래에 배치하고, `.codex/config.toml`에 Codex-adapted `nx` MCP 서버와 optional MCP 통합을 설정합니다. 현재 기본 통합은 hosted `Context7`이고, 기본 설치는 startup failure를 피하기 위해 `url` only remote MCP로 구성됩니다. 더 높은 rate limit이나 인증이 필요하면 Context7 문서에 맞춰 API key 기반 header를 수동으로 추가하세요.

`nexus-core@0.16.0`부터 `.codex/agents/*.toml`은 Codex가 바로 읽는 standalone role file 스키마입니다. 이어서 `nexus-core@0.16.2`는 `disabled_tools`를 Codex가 허용하는 `[mcp_servers.nx]` 블록 아래로 옮겨 malformed role rejection을 해결했습니다. `0.16.0` 또는 `0.16.1` 기반 agent TOML이 설치돼 있었다면 upgrade 뒤에 `codex-nexus install --scope user` 또는 `codex-nexus install --scope project`를 다시 실행해 agent 파일을 교체하세요.

AGENTS 동작은 scope별로 다릅니다.

- `--scope user` 는 `~/.codex/AGENTS.md`를 갱신하고 현재 레포의 `./AGENTS.md`는 건드리지 않습니다
- `--scope project` 는 현재 레포의 `./AGENTS.md`를 갱신합니다

명시적으로 설치하려면:

```bash
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.2.0
```

optional MCP 통합 없이 core만 설치하려면:

```bash
codex-nexus install --core-only
```

설치 상태를 확인하려면:

```bash
codex-nexus doctor --scope user
codex-nexus doctor --scope project
```

### 2. Onboard Your Project

프로젝트에서 먼저 `$nx-init`을 실행해 `.nexus/` 지식을 생성하세요.

```text
$nx-init
```

이 entrypoint는 프로젝트를 스캔하고 초기 knowledge/context/rules 구조를 준비하는 온보딩 워크플로를 로드합니다.

### 3. Start Using It

- 플랜: `[plan] 인증 플로우를 어떻게 설계할까?`
- 결정 기록: `그 방향으로 가자 [d]`
- 실행: `[run] 합의한 인증 플로우를 구현해줘`

전형적인 흐름은:

`[plan]`으로 정리 → `[d]`로 결정 기록 → `[run]`으로 실행

## Usage

| Tag | 동작 | 예시 |
|---|---|---|
| `[plan]` | 구현 전 의사결정 모드 | `[plan] DB 마이그레이션 전략 논의` |
| `[run]` | 태스크 기반 실행 모드 | `[run] 로그인 API 구현` |
| `[d]` | 현재 플랜 이슈의 결정 기록 | `2안으로 가자 [d]` |
| `[sync]` | `.nexus/context/` 동기화 | `[sync] 최근 구조 변경을 context 문서에 반영` |
| `[rule]` | 팀 규칙 저장 | `[rule] 기본 패키지 매니저는 bun` |
| `[rule:<tag>]` | 태그가 포함된 규칙 저장 | `[rule:testing] 배포 전 test 필수` |
| `[m]` | 메모/레퍼런스 저장 | `[m] 이번 장애 대응 교훈 저장` |
| `[m:gc]` | memory 정리 | `[m:gc] 중복 memory 정리` |

## Agents

메인 thread의 primary agent는 `Lead`이며, Codex AGENTS.md에는 core-generated lead fragment가 병합됩니다.

### How

| Agent | Role | Model |
|---|---|---|
| Architect | 기술 설계와 아키텍처 리뷰 | `gpt-5.4` |
| Designer | UX/UI와 인터랙션 설계 | `gpt-5.4` |
| Postdoc | 리서치 방법론 설계와 증거 종합 | `gpt-5.4` |
| Strategist | 전략, 포지셔닝, 비즈니스 판단 | `gpt-5.4` |

### Do

| Agent | Role | Model |
|---|---|---|
| Engineer | 구현과 디버깅 | `gpt-5.3-codex` |
| Researcher | 독립 조사와 웹 리서치 | `gpt-5.3-codex` |
| Writer | 문서와 작성형 산출물 | `gpt-5.3-codex` |

### Check

| Agent | Role | Model |
|---|---|---|
| Tester | 테스트, 검증, 안정성 확인 | `gpt-5.3-codex` |
| Reviewer | 문서/사실/형식 검토 | `gpt-5.3-codex` |

## Entrypoints

| Entrypoint | Purpose |
|---|---|
| `$nx-init` | 프로젝트 온보딩과 초기 `.nexus/` 지식 생성 |
| `[plan]` | 구조화된 논의와 결정 |
| `[run]` | 태스크 기반 실행 |
| `[sync]` | `.nexus/context/` 동기화 |

## Subagent Resume

완료된 subagent는 Codex native resume 흐름으로 다시 이어서 호출할 수 있습니다.

- plan mode: `nx_plan_resume`, `nx_plan_followup`가 `resume_agent -> send_input` 순서의 follow-up guidance를 반환합니다.
- run mode: `nx_task_resume`가 task의 `owner_agent_id`, `owner_reuse_policy`, `agent-tracker.json`을 기준으로 resume 가능 여부를 계산합니다.
- `persistent` tier: 이전 완료 세션이 있으면 기본적으로 resume
- `bounded` tier: task에 `owner_agent_id`가 저장되어 있어야 하며, follow-up prompt 앞에 `Re-read target files before any modification.`가 붙습니다.
- `ephemeral` tier: 항상 fresh spawn

run mode에서 continuity를 유지하려면 첫 spawn 뒤 returned agent id를 task에 저장하세요.

```text
nx_task_update(id=<task id>, owner_agent_id=<returned agent id>, status="in_progress")
```

## What Install Writes

설치가 완료되면 선택한 scope 아래에 다음이 생성되거나 갱신됩니다.

- `.codex/packages/node_modules/codex-nexus`
- `.codex/config.toml` (`nx` MCP, 기본적으로 hosted `context7` MCP 포함)
- `.codex/hooks.json`
- `.codex/skills/*` (`plugin/skills/`에서 복사)
- `.codex/agents/*.toml` (`nexus-core` 자산에서 생성된 standalone Codex role file)
- scope별 AGENTS target의 lead fragment (`install/AGENTS.fragment.md`)

AGENTS target:

- `user` — `~/.codex/AGENTS.md`
- `project` — 현재 레포의 `./AGENTS.md`

Scope 의미:

- `user` — `~/.codex`에 설치되어 여러 저장소에서 공유
- `project` — 현재 저장소의 `./.codex`에 설치

## Project Knowledge

`codex-nexus`는 프로젝트 지식과 실행 상태를 `.nexus/`에 저장합니다.

```text
.nexus/
  memory/     lessons learned, references
  context/    architecture and design context
  rules/      team rules
  history.json
  state/      active plan/task runtime state
```

- `memory/`, `context/`, `rules/`, `history.json`은 프로젝트 지식입니다.
- `state/`는 런타임 상태이며 git에서 제외됩니다.

runtime state는 core session root `.nexus/state/<session_id>/` 아래에 저장됩니다. 예:

- `.nexus/state/<session_id>/agent-tracker.json`
- `.nexus/state/<session_id>/tool-log.jsonl`
- `.nexus/state/<session_id>/plan.json`
- `.nexus/state/<session_id>/tasks.json`

## CLI

```bash
bun run sync:core
codex-nexus install
codex-nexus install --core-only
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.2.0
codex-nexus doctor --scope project
codex-nexus version
```
