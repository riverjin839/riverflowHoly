# Holy Flow — Daily QT & Devotional Life App

## 제품 비전
매일의 QT, 말씀 묵상, 기도제목, 감사, 영적 루틴을 날짜별로 기록하고 돌아보며 영적 성장을 돕는 모바일/PC 반응형 웹 앱입니다.

## 핵심 기능
- 달력 날짜 이동(이전/다음 + 날짜 선택기)
- QT/기도/감사/루틴 날짜별 기록
- 항목 수정/삭제 및 기도 응답 체크
- IndexedDB 자동 저장 + localStorage fallback
- 백업 파일(JSON) 내보내기/불러오기

## 데이터 저장 방식
1. 기본 저장소: **IndexedDB**
   - 브라우저 내 구조화 저장소로 LocalStorage보다 용량/안정성 측면에서 유리
   - 앱 변경사항이 자동 저장되어 새로고침 후에도 유지
2. 보조 저장소: **localStorage fallback**
   - IndexedDB 미지원/오류 상황에서 데이터 손실 완화를 위해 동시 저장
3. 백업 파일(JSON)
   - 사용자가 수동으로 내보내기/불러오기 가능
   - 브라우저 데이터 삭제/기기 변경 상황에 대비한 영구 보관 관리 수단

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
