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

## 1-1. 변경 이력 관리

배포 전에 이번 릴리스에서 무엇이 바뀌었는지 사람이 읽을 수 있는 형태로 정리되어 있어야 한다.

- `CHANGELOG.md`를 정식 변경 이력 파일로 유지한다
- 새 릴리스 전 `CHANGELOG.md`에 새 버전 섹션이 추가되어 있는가
- `CHANGELOG.md`에는 최소한 아래가 정리되어 있는가
  - 사용자에게 보이는 변경
  - 설치/업데이트 방식 변화
  - 호환성에 영향을 주는 변경
  - 버그 수정
- 버전 간 릴리스가 여러 번 연속으로 있었다면, 마지막 정상 릴리스 이후 누적 변경이 빠지지 않았는가
- 설치 예시나 명시 버전이 바뀐 경우 문서 예시도 함께 갱신되었는가

## 1-2. PR 준비 상태

배포 전에 PR 기준으로 아래가 정리되어 있어야 한다.

- PR 제목이 변경 목적을 충분히 설명하는가
- PR 본문에 최소한 아래가 포함되는가
  - 무엇이 바뀌었는가
  - 왜 바뀌었는가
  - 어떻게 검증했는가
  - 사용자 영향이나 마이그레이션 포인트가 있는가
- 릴리스용 PR이라면 최종 배포 버전이 본문이나 체크리스트에 명시되어 있는가
- 관련 이슈나 이전 실패 릴리스가 있다면 PR 본문에서 연결되어 있는가

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

### 3-1. Installer 실행 버전 확인

- installer는 현재 실행 중인 `codex-nexus` 버전만 설치해야 한다
- installer 내부에서 별도 버전 선택 UI가 없어야 한다
- 특정 버전을 설치하려면 `npx -y codex-nexus@<version> install` 또는 `bunx codex-nexus@<version> install` 로 호출해야 한다

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
- `mcp_servers.nx` 가 bare `npx` 가 아니라 설치된 런타임 절대경로 + 설치된 `nexus-core` server.js 절대경로를 쓰는가
- `mcp_servers.nx` 가 실행한 `codex-nexus` 버전에 맞는 `@moreih29/nexus-core` pin을 쓰는가

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

- `.gitignore` 에 project-local install artifact 용 ignore 항목이 추가되었는가
  - `.codex/`
  - `.agents/`

### 3-4. npm / Trusted Publishing 확인

배포 직전 한 번 더 확인한다.

- npm trusted publishing 설정이 아직 유효한가
  - package: `codex-nexus`
  - repository: `moreih29/codex-nexus`
  - workflow: `publish-npm.yml`

## 4. 권장 배포 순서

1. 코드와 문서 변경 마무리
2. changelog 또는 릴리스 노트 초안 갱신
3. PR 본문 최종 정리
4. 자동 검증 전체 실행
5. 수동 확인 항목 점검
6. 릴리스용 커밋 생성
7. `v<version>` 태그 생성
8. 브랜치와 태그 푸시
9. `validate.yml` 통과 확인
10. `publish-npm.yml` publish 확인

## 5. 병합과 브랜치 정리 규칙

배포까지 끝난 뒤에는 작업 브랜치를 정리한다.

- 배포에 사용된 브랜치는 PR이 merge 된 뒤 삭제하는 것을 기본으로 한다
- 로컬 브랜치도 추가 작업이 없다면 삭제한다
- 단, 아래 경우는 예외로 둘 수 있다
  - 아직 확인하지 않은 후속 이슈가 남아 있음
  - 배포 직후 hotfix 가능성이 높음
  - 관련 후속 작업을 같은 브랜치에서 바로 이어가기로 명시적으로 결정함
- 이미 tag로 남아 있으므로, 배포 완료 후 브랜치를 유지할 실익이 있는지 먼저 따져보고 정리한다
- 연속 패치 릴리스가 있었다면, 최종 정상 릴리스 tag 기준으로 어떤 커밋이 실제 배포본인지 PR/릴리스 노트에서 혼동 없게 남긴다

## 6. GitHub Release 규칙

npm publish가 끝났다고 릴리스 절차가 완전히 끝난 것으로 보지 않는다.  
해당 tag에 대응하는 GitHub Release도 정리한다.

- 배포 성공 후 `v<version>` tag 기준으로 GitHub Release를 생성한다
- 이미 자동 생성된 Draft가 있으면 내용을 정리해서 publish 하고, 없으면 수동 생성한다
- GitHub Release 제목은 tag와 일치시키는 것을 기본으로 한다
  - 예: `v0.3.6`
- Release 본문에는 최소한 아래를 포함한다
  - 이번 버전의 핵심 변경 사항
  - 사용자 영향이 있는 변경
  - 설치나 업데이트 방식 변화
  - 버그 수정 사항
  - 주의할 점이나 알려진 제한
- 연속 패치 릴리스였다면, 이전 실패/부분 릴리스와 구분해서 “최종적으로 권장하는 버전”을 명시한다
- npm 링크가 필요한 경우 Release 본문에 `https://www.npmjs.com/package/codex-nexus` 를 포함한다
- GitHub Release 본문은 changelog 또는 PR 본문과 내용이 충돌하지 않게 유지한다

## 7. 배포 후 확인

배포 후 아래를 확인한다.

- `npm view codex-nexus version`
- npm에 새 버전이 보이는가
- `npx -y codex-nexus@<version> --help` 가 정상 동작하는가
- publish 된 패키지로 fresh install + doctor 스모크 테스트를 최소 한 번 실행했는가
- interactive install 버전 목록에 새 버전이 보이는가
- 해당 tag의 GitHub Release가 생성되었는가
- GitHub Release 본문이 실제 배포 내용과 일치하는가

## 배포 중단 조건

아래 중 하나라도 발생하면 배포하지 않는다.

- 자동 검증 명령 중 하나라도 실패함
- `npm pack --dry-run` 결과에 installer 또는 plugin 자산이 빠져 있음
- clean install 환경에서 `doctor` 가 실패함
- 설치된 hooks 가 개발 레포 경로를 바라봄
- `model_instructions_file` 이 머신 의존 절대경로로 기록됨
- `package.json`, README 예시, git tag 사이에 버전 불일치가 있음
- 실행한 `codex-nexus` 버전과 실제 적용된 `@moreih29/nexus-core` 버전이 어긋남
- changelog 또는 PR 본문만 봐서는 이번 릴리스 범위를 설명할 수 없음
- GitHub Release까지 포함한 최종 릴리스 산출물을 남길 수 없는 상태임
