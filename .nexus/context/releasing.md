# codex-nexus 배포 체크리스트

`codex-nexus`를 npm에 배포하기 전 최종 점검 문서.

이 문서의 목적은 두 가지다.

- 자동 검증으로 충분한 항목은 빠짐없이 실행했는지 확인
- 자동화되지 않은 수동 확인 항목을 별도로 관리

## 배포 전 목표

배포는 아래가 모두 만족될 때만 진행한다.

- npm에 올라갈 패키지 안에 필요한 플러그인/installer 자산이 모두 들어 있다
- installer가 최종 사용자 기준 `user` / `project` 경로를 올바르게 설정한다
- 선택한 `codex-nexus` 버전에 맞는 `@moreih29/nexus-core` pin이 함께 적용된다
- README, 라이선스, GitHub Actions 설정이 실제 릴리스 절차와 일치한다

## 1. 버전과 메타데이터 확인

배포 전에 먼저 아래를 확인한다.

- `package.json.version` 이 이번 배포 버전과 정확히 일치하는가
- 태그가 정확히 `v<package.json.version>` 형식인가
- README 안에 명시 버전 예시가 있다면 현재 배포 버전과 일치하는가
- `LICENSE` 파일이 존재하는가
- `package.json.license` 값이 라이선스 파일과 일치하는가
- `README.md` 와 `README.en.md` 가 둘 다 존재하는가
- 두 README가 서로 링크되어 있는가

## 2. 자동 검증

아래 명령은 배포 전에 반드시 실행한다.

```bash
bun install
bun run sync:core
bun run validate
bun test
node scripts/codex-nexus.mjs --help
node scripts/codex-nexus.mjs doctor --scope project
npm pack --dry-run
```

기대 결과:

- 실패하는 명령이 없어야 한다
- `Doctor passed.` 가 나와야 한다
- `npm pack --dry-run` 결과에 installer 와 plugin 자산이 모두 포함되어야 한다

CI 기준으로는 아래 워크플로우가 준비되어 있어야 한다.

- `.github/workflows/validate.yml`
- `.github/workflows/publish-npm.yml`
- `publish-npm.yml` 이 `validate.yml` 을 선행 실행하는가
- `publish-npm.yml` 이 git tag 와 `package.json.version` 일치 여부를 검사하는가

## 3. 수동 확인

아래 항목은 자동 테스트와 별도로 사람이 직접 확인한다.

### 3-1. Installer 호환 버전 확인

- interactive install 에서 호환되는 버전만 보여야 한다
- `0.3.0` 미만 버전은 선택지에 나오면 안 된다
- `0.3.0` 미만 버전을 직접 `--version` 으로 넣으면 호환 불가 에러가 나야 한다

### 3-2. User scope 스모크 테스트

깨끗한 임시 홈 디렉터리에서 아래를 확인한다.

1. `npx -y codex-nexus@<target-version> install --scope user`
2. `npx -y codex-nexus@<target-version> doctor --scope user`
3. 아래 파일 직접 확인
   - `~/.codex/config.toml`
   - `~/.codex/hooks.json`
   - `~/.codex/agents/lead.toml`
   - `~/.agents/skills/nx-plan/SKILL.md`
   - `~/.agents/plugins/marketplace.json`

확인 포인트:

- `model_instructions_file` 이 절대경로가 아니라 상대경로인가
- hooks 가 개발 레포 경로가 아니라 설치된 package store 경로를 바라보는가
- `mcp_servers.nx` 가 선택한 `codex-nexus` 버전에 맞는 `@moreih29/nexus-core` pin을 쓰는가

### 3-3. Project scope 스모크 테스트

깨끗한 임시 git 저장소에서 아래를 확인한다.

1. `npx -y codex-nexus@<target-version> install --scope project`
2. `npx -y codex-nexus@<target-version> doctor --scope project`
3. 아래 파일 직접 확인
   - `<repo>/.codex/config.toml`
   - `<repo>/.codex/hooks.json`
   - `<repo>/.codex/agents/lead.toml`
   - `<repo>/.agents/skills/nx-plan/SKILL.md`
   - `<repo>/.agents/plugins/marketplace.json`
   - `<repo>/plugins/codex-nexus`

추가 확인:

- `.gitignore` 에 필요한 최소 항목만 추가되었는가

### 3-4. npm / Trusted Publishing 확인

배포 직전 한 번 더 확인한다.

- npm trusted publishing 설정이 아직 유효한가
  - package: `codex-nexus`
  - repository: `moreih29/codex-nexus`
  - workflow: `publish-npm.yml`

## 4. 권장 배포 순서

1. 코드와 문서 변경 마무리
2. 자동 검증 전체 실행
3. 수동 확인 항목 점검
4. 릴리스용 커밋 생성
5. `v<version>` 태그 생성
6. 브랜치와 태그 푸시
7. `validate.yml` 통과 확인
8. `publish-npm.yml` publish 확인

## 5. 배포 후 확인

배포 후 아래를 확인한다.

- `npm view codex-nexus version`
- npm에 새 버전이 보이는가
- `npx -y codex-nexus@<version> --help` 가 정상 동작하는가
- publish 된 패키지로 fresh install + doctor 스모크 테스트를 최소 한 번 실행했는가
- interactive install 버전 목록에 새 버전이 보이는가

## 배포 중단 조건

아래 중 하나라도 발생하면 배포하지 않는다.

- 자동 검증 명령 중 하나라도 실패함
- `npm pack --dry-run` 결과에 installer 또는 plugin 자산이 빠져 있음
- clean install 환경에서 `doctor` 가 실패함
- 설치된 hooks 가 개발 레포 경로를 바라봄
- `model_instructions_file` 이 머신 의존 절대경로로 기록됨
- `package.json`, README 예시, git tag 사이에 버전 불일치가 있음
- 선택한 `codex-nexus` 버전과 실제 적용된 `@moreih29/nexus-core` 버전이 어긋남
