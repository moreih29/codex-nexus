# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

형식은 Keep a Changelog 스타일을 느슨하게 따르며, 버전 표기는 SemVer 기준으로 관리한다.

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
