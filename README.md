# codex-nexus

[![npm version](https://img.shields.io/npm/v/codex-nexus)](https://www.npmjs.com/package/codex-nexus)

> 🌏 [English](README.en.md)

OpenAI Codex CLI를 위한 Nexus 오케스트레이션 플러그인.

`codex-nexus`는 Codex의 도구 호출과 에이전트 실행을 ad-hoc 프롬프트 대신 구조화된 Nexus 워크플로로 연결합니다. 복잡한 작업을 바로 구현으로 밀어붙이기보다, 먼저 정리하고, 결정하고, 태스크 단위로 실행하고, 프로젝트 지식을 `.nexus/`에 축적하게 해줍니다.

## Why

- 구현 전에 `[plan]`으로 먼저 정리
- `[run]`에서 태스크 기반으로 실행
- 완료된 specialist subagent를 Codex native resume로 이어서 호출 가능
- `.nexus/`에 프로젝트 지식과 결정 기록 유지
- 역할이 분리된 Codex-native 에이전트 카탈로그 제공
- `nx` MCP 도구로 plan/task/history/context 흐름 사용

## Quick Start

### 1. Install

`codex-nexus`는 npm으로 배포되지만, 설치된 hooks와 MCP 서버는 `bun`으로 실행됩니다.

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

`install`은 `.codex/config.toml`에 `nx` MCP 서버와 optional MCP 통합을 기본으로 설정합니다. 현재 기본 통합은 hosted `Context7`이고, Context7 인증과 더 높은 rate limit을 쓰려면 셸에 `CONTEXT7_API_KEY`를 export 해두세요.

명시적으로 설치하려면:

```bash
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.1.0
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
- `.codex/skills/nx-init`
- `.codex/skills/nx-plan`
- `.codex/skills/nx-run`
- `.codex/skills/nx-sync`
- `.codex/agents/*.toml`
- `AGENTS.md`의 Codex Nexus section

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

resume 관련 런타임 상태는 주로 여기에 저장됩니다.

- `.nexus/state/codex-nexus/agent-tracker.json`
- `.nexus/state/codex-nexus/tool-log.jsonl`

## CLI

```bash
codex-nexus install
codex-nexus install --core-only
codex-nexus install --scope user --version latest
codex-nexus install --scope project --version 0.1.0
codex-nexus doctor --scope project
codex-nexus version
```
