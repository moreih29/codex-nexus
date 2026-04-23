# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

형식은 Keep a Changelog 스타일을 느슨하게 따르며, 버전 표기는 SemVer 기준으로 관리한다.

## [0.3.11] - 2026-04-23

### Changed

- `@moreih29/nexus-core`를 `0.20.0`으로 올리고 Codex generated Lead / `nx-auto-plan` / `nx-plan` / `nx-run` 자산을 최신 upstream 계약에 맞게 다시 동기화
- publishable subagent source는 upstream의 bare `nexus-mcp` 메타데이터를 유지하되, installer가 실제 설치 결과물에서는 런타임 절대경로 + 설치된 `nexus-core` `server.js` 경로로 rewrite 하도록 정리
- `sync:core`가 generated subagent를 다시 받아와도 downstream launcher compatibility line(`command = "nexus-mcp"`)을 자동으로 복구하도록 갱신

### Fixed

- install 결과의 child-agent TOML이 부분 `mcp_servers` 상속에 기대지 않고 항상 launchable한 MCP transport를 갖도록 수정
- `doctor`와 테스트가 bare launcher 회피만 보는 대신, 설치된 agent MCP launcher가 실제 존재하는 실행 경로와 server path를 가리키는지 확인하도록 강화하고, `validate`는 publishable source contract를 별도로 점검하도록 정리
- clean user-scope install 기준으로 malformed agent role / `invalid transport` 경고로 이어지던 child-agent launcher 구성을 installer에서 launchable 경로로 재작성하도록 정리

## [0.3.10] - 2026-04-22

### Changed

- `@moreih29/nexus-core`를 `0.19.2`로 올리고 Codex / planning generated assets를 최신 upstream 계약에 맞게 다시 동기화
- Codex child-agent가 부모 세션의 `nx` MCP launcher를 상속하도록, downstream wrapper의 child-agent launcher rewrite workaround를 제거

### Fixed

- spawned Nexus subagent가 bare `nexus-mcp` 가정 때문에 MCP startup failure를 일으키던 경로를 upstream fix에 맞춰 정리
- `doctor`, validation, 테스트가 child-agent launcher 상속 모델과 실제 publishable package 구조를 기준으로 동작하도록 갱신
- upstream planning skill 보완에 맞춰 resume 매크로 안내가 명시적으로 포함된 generated skill 문서를 동기화

## [0.3.9] - 2026-04-22

### Fixed

- GitHub Actions `validate` workflow가 repo-root local install artifact를 더 이상 tracked source로 가정하지 않도록, `doctor --scope project` 전에 `install --scope project`를 수행하게 수정
- `0.3.8` 태그에서 publish workflow가 실패하던 CI 검증 경로를 복구

## [0.3.8] - 2026-04-22

### Changed

- `@moreih29/nexus-core`를 `0.19.0`으로 올리고 plan skill 생성물을 최신 계약에 맞게 동기화
- repo에서 `plugins/codex-nexus`만 tracked publishable source로 남기고, project-scope install 산출물인 repo-root `.codex` / `.agents`는 추적하지 않도록 구조를 정리
- project install 시 `.gitignore`가 `.codex/`, `.agents/` 디렉터리 전체를 로컬 install artifact로 무시하도록 변경

### Fixed

- 검증과 레이아웃 테스트가 repo self-install fixture 대신 publishable plugin 자산과 실제 installer 동작을 기준으로 확인하도록 정리
- plugin hook self-pin이 당시 배포 버전 `0.3.8`을 가리키도록 갱신

## [0.3.7] - 2026-04-22

### Added

- `CHANGELOG.md`를 정식 변경 이력 파일로 도입

### Changed

- 릴리스 체크리스트 문서를 changelog 중심 운영 기준으로 정리
- changelog 섹션이 GitHub Release 본문 초안으로 바로 재사용될 수 있도록 릴리스 흐름을 정형화

## [0.3.6] - 2026-04-22

### Fixed

- published tarball 설치 검증 테스트의 timeout을 늘려 GitHub Actions false failure를 줄임
- `0.3.5`에서 기능은 정상이었지만 CI에서 간헐적으로 실패하던 릴리스 경로를 안정화함

## [0.3.5] - 2026-04-22

### Fixed

- `@moreih29/nexus-core`를 runtime dependency로 포함해, published package 설치 후에도 `nx` MCP가 실제로 동작하도록 수정
- tarball 설치 기준으로 `nexus-core`가 함께 내려오는지 검증 테스트를 추가

## [0.3.4] - 2026-04-22

### Fixed

- `doctor`가 runtime 절대경로 기반 `nx` MCP 설정을 올바르게 검사하도록 수정
- 설치된 runtime + 설치된 `nexus-core` server 경로가 실제로 존재하는지 기준으로 점검하도록 강화

## [0.3.3] - 2026-04-22

### Fixed

- `nx` MCP를 `npx` 대신 설치된 runtime + 설치된 `nexus-core` server entry 절대경로로 연결하도록 변경
- 사용자의 PATH 구성에 따라 `npx`를 찾지 못해 MCP가 실패하던 문제를 줄이기 위한 릴리스

## [0.3.2] - 2026-04-22

### Fixed

- installer가 현재 실행 중인 `codex-nexus` 버전만 설치하도록 변경
- Bun 전역 설치에서 CLI가 무반응이던 main entry 판별 문제 수정
- 설치 버전과 실행 버전이 달라질 수 있던 구조를 제거해 installer 동작을 단순화

## [0.3.1] - 2026-04-22

### Fixed

- non-interactive install 기본 버전을 현재 실행 중인 패키지 버전으로 고정
- registry propagation 타이밍에 따라 `latest` 해석이 엇갈릴 수 있던 문제를 완화

## [0.3.0] - 2026-04-22

### Added

- installer 기반 Codex plugin 배포 구조 도입
- `plugins/codex-nexus` 플러그인 번들 추가
- Lead wiring, hooks, agents, skills 자동 설치 지원
- `validate.yml`, `publish-npm.yml` 워크플로우 추가
- 한글/영문 README, LICENSE, 릴리스 문서 정비

### Changed

- 기존 레거시 패키지 구조를 installer 중심 구조로 재구성
- 최종 사용자 기준 `~/.codex`, `~/.agents`, `<repo>/.codex`, `<repo>/.agents` 경로를 직접 설정하는 방식으로 전환
