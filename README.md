# Holy Flow — Daily QT & Devotional Life App

## 제품 비전
매일의 QT, 말씀 묵상, 기도제목, 감사, 영적 루틴을 날짜별로 기록하고 돌아보며 영적 성장을 돕는 모바일/PC 반응형 웹 앱입니다.

## 핵심 기능
- 달력 날짜 이동(이전/다음 + 날짜 선택기)
- QT/기도/감사/루틴 날짜별 기록
- 항목 수정/삭제 및 기도 응답 체크
- IndexedDB 자동 저장 + localStorage fallback
- 백업 파일 내보내기/불러오기: 일반 JSON 또는 보호 백업(.hfbak, 비밀번호 + 암호화)

## 데이터 저장 방식
1. 기본 저장소: **IndexedDB**
   - 브라우저 내 구조화 저장소로 LocalStorage보다 용량/안정성 측면에서 유리
   - 앱 변경사항이 자동 저장되어 새로고침 후에도 유지
2. 보조 저장소: **localStorage fallback**
   - IndexedDB 미지원/오류 상황에서 데이터 손실 완화를 위해 동시 저장
3. 백업 파일(JSON)
   - 사용자가 수동으로 내보내기/불러오기 가능
   - 브라우저 데이터 삭제/기기 변경 상황에 대비한 영구 보관 관리 수단

## 백업 포맷 선택
- 일반 JSON: 다른 도구와 호환성이 높고 사람이 읽기 쉬움
- 보호 백업(.hfbak): 비밀번호 기반 암호화(AES-GCM) 적용, 브라우저가 지원하면 gzip 압축까지 적용

## 친구들과 공유해서 PC/모바일에서 쓰는 방법

### 1) 가장 쉬운 방법: GitHub Pages 배포
1. 이 저장소를 GitHub에 push
2. GitHub 저장소 → **Settings → Pages**
3. Source를 `Deploy from a branch`로 선택
4. Branch를 `main` / folder를 `/ (root)`로 선택 후 저장
5. 배포 URL 생성 후 친구들에게 공유

### 2) Netlify / Vercel 정적 배포
- 저장소 연결만 하면 자동 배포됩니다.
- 빌드 설정 없이 정적 사이트로 바로 배포 가능합니다.

## 모바일에서 앱처럼 사용(PWA)
- 홈화면에 추가(Install/Add to Home Screen) 지원
- 오프라인에서도 앱 셸(기본 화면) 로드 가능
- 상단 `앱 설치` 버튼이 표시되면 설치 가능

## 데이터 보관 관련 안내
- 데이터는 **각 사용자 기기 브라우저**에 저장됩니다.
- 즉, 링크를 공유해도 친구들의 데이터는 서로 섞이지 않습니다.
- 기기 변경 대비를 위해 주기적으로 `백업 파일 내보내기`를 권장합니다.

## 로컬 실행
```bash
python3 -m http.server 4173
```
브라우저에서 `http://localhost:4173` 접속

## Windows 사용자: EXE 하나로 실행
가장 쉬운 방법은 `HolyFlow.exe` 단일 파일을 받아 더블클릭하는 방식입니다.

실행 방법:
1. GitHub 저장소의 **Actions → Build Windows EXE** 실행 결과(Artifacts)에서 `HolyFlow-Windows-EXE.zip` 다운로드
2. 압축 해제 후 `HolyFlow.exe` 더블클릭 실행
3. 브라우저가 자동으로 열리면 그대로 사용

참고:
- 앱 종료는 상단의 `앱 종료` 버튼으로 종료
- 4173 포트가 이미 사용 중이면 자동으로 다른 포트 사용
- macOS 로컬 `dist/`에는 `.exe`가 생기지 않습니다. EXE는 Windows runner(또는 Windows PC 빌드)에서 생성됩니다.
- 다운로드 파일에 확장자가 안 보이면 파일명 끝에 `.zip`을 붙인 뒤 압축 해제하세요.

## 개발자용: Windows 단일 EXE 빌드
Windows에서 아래 명령으로 `HolyFlow.exe`를 생성할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-win-exe.ps1
```

생성 결과:
- `dist/HolyFlow-Windows-EXE/HolyFlow.exe`
- `dist/HolyFlow-Windows-EXE/README-EXE.txt`
- `dist/HolyFlow-Windows-EXE.zip`

CI 자동 빌드:
- GitHub Actions의 `Build Windows EXE` 워크플로에서 아티팩트로 EXE를 받을 수 있습니다.
- 릴리즈 노트 템플릿: `/docs/release-notes/windows-exe-template.md`

## macOS 사용자: APP 하나로 실행
가장 쉬운 방법은 `HolyFlow.app` 번들을 받아 실행하는 방식입니다.

실행 방법:
1. GitHub 저장소의 **Actions → Build macOS App** 실행 결과(Artifacts)에서 본인 칩셋에 맞는 파일 다운로드
2. `HolyFlow-macOS-Universal.zip` 다운로드
3. 압축 해제 후 내부의 `.app` 실행
4. 브라우저가 자동으로 열리면 그대로 사용

참고:
- 첫 실행 시 macOS가 앱을 차단하면 `Open-Privacy-and-Security.command`를 실행하면 `개인정보 보호 및 보안` 창이 자동으로 열립니다.
- `설정 > 개인정보 보호 및 보안`에서 `HolyFlow` 항목의 `그래도 열기`를 누른 뒤 다시 실행하세요.
- 런처가 실행되면 보안 설정 창을 1회 자동 오픈해 해당 위치로 바로 이동할 수 있게 처리되어 있습니다.
- 필요 시 `HolyFlow.app`을 우클릭 후 `열기`로도 실행할 수 있습니다.
- 앱 종료는 상단의 `앱 종료` 버튼으로 종료
- 4173 포트가 이미 사용 중이면 자동으로 다른 포트 사용
- 다운로드 파일에 확장자가 안 보이면 파일명 끝에 `.zip`을 붙인 뒤 압축 해제하세요.

## 개발자용: macOS APP 빌드
macOS에서 아래 명령으로 `HolyFlow.app`를 생성할 수 있습니다.

```bash
chmod +x ./scripts/build-mac-app.sh
./scripts/build-mac-app.sh
```

생성 결과:
- `dist/HolyFlow-macOS-App/HolyFlow.app`
- `dist/HolyFlow-macOS-App/README-MACOS.txt`
- `dist/HolyFlow-macOS-App/Open-Privacy-and-Security.command`
- `dist/HolyFlow-macOS-App.zip`

CI 자동 빌드:
- GitHub Actions의 `Build macOS App` 워크플로에서 Universal 아티팩트로 APP을 받을 수 있습니다.

## Windows 포터블 배포 패키지 만들기
macOS/Linux에서 아래 명령을 실행하면 Windows에서 압축 해제 후 바로 실행 가능한 폴더가 생성됩니다.

```bash
bash scripts/build-win-portable.sh
```

생성 결과:
- `dist/HolyFlow-Windows-Portable/`
- `dist/HolyFlow-Windows-Portable.zip` (zip 명령이 있을 때)

Windows 사용자 실행 방법:
1. `HolyFlow-Windows-Portable.zip` 압축 해제
2. `start-holy-flow.bat` 더블클릭
3. 브라우저에서 `http://localhost:4173` 자동 오픈
