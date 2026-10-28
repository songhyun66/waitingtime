# 보건실 대기열

학생이 보건실 앞 화면(student.html)에서 접수하면 보건 선생님 대시보드(teacher.html)에 실시간으로 나타나는 웹앱입니다. 백엔드는 Supabase를 씁니다. 빌드 과정 없이 정적 파일만으로 동작하므로 GitHub Pages에 그대로 올릴 수 있습니다.

## 파일 구성

```
index.html            첫 화면 (각 페이지로 가는 링크)
student.html          학생 접수 화면
teacher.html          교사 대시보드
check.html            Supabase 연결 점검 페이지
css/                  페이지별 스타일
js/config.js          Supabase 주소와 키 (설정할 곳은 여기 하나)
js/supabase.js        클라이언트 생성, 키 형식 검사, 오류 설명, 실시간 구독과 연결 상태 관리
js/student.js         학생 화면 로직
js/teacher.js         교사 화면 로직
js/check.js           연결 점검 로직
js/util.js            HTML 이스케이프, 시간 표시
supabase/schema.sql   테이블, RLS 정책, Realtime 등록 SQL
```

## 1. Supabase 준비

1. Supabase 프로젝트의 **SQL Editor**에서 `supabase/schema.sql` 내용을 붙여넣고 실행합니다. 테이블이 이미 있으면 테이블 생성은 건너뛰고 권한과 Realtime 설정만 적용됩니다.
2. **Project Settings > API Keys**에서 **Publishable key**(`sb_publishable_...`)를 복사합니다. 없으면 같은 화면에서 새로 만들면 됩니다.

## 2. js/config.js 채우기

```js
export const SUPABASE_URL = "https://abcdefgh.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_...";
```

### 어떤 키를 넣어야 하나

| 키 | 모양 | 여기에 넣어도 되나 |
| --- | --- | --- |
| Publishable | `sb_publishable_...` | 넣어야 하는 키입니다. 공개돼도 RLS가 허용한 일만 할 수 있습니다. |
| legacy anon | `eyJ...`로 시작하는 긴 키 | 지금은 동작하지만 Supabase가 2026년 말까지 폐기할 예정이라 바꿔야 합니다. |
| Secret, legacy service_role | `sb_secret_...`, `eyJ...` | 절대 넣으면 안 됩니다. RLS를 무시하는 관리자 키입니다. |

앱이 키 모양을 보고 종류를 판별합니다. legacy anon 키면 경고를 띄우고, Secret이나 service_role 키면 아예 실행을 거부합니다.

Publishable 키는 원래 브라우저에 노출되는 것을 전제로 한 키라서 config.js를 그대로 커밋해도 됩니다.

## 3. 실행하기

ES 모듈을 쓰기 때문에 HTML 파일을 더블클릭해서(file://) 열면 동작하지 않습니다. 아래 중 하나로 여세요.

- 로컬: 이 폴더에서 `npx serve .` 또는 `python -m http.server 8000`을 실행하고 브라우저로 접속
- VS Code: Live Server 확장으로 열기
- GitHub Pages: 저장소 **Settings > Pages**에서 브랜치(main)와 루트 폴더를 선택

## 4. 연결 확인하는 법

**check.html**을 열면 아래 순서로 점검하고, 각 단계에서 무엇이 문제인지 한국어로 알려줍니다.

1. 설정값: URL 형식, 키 종류(Publishable인지 legacy인지 Secret인지), 키와 URL의 프로젝트 일치 여부
2. 서버 연결과 API 키: 서버에 닿는지, 키가 받아들여지는지
3. 테이블 읽기: 테이블이 있는지, 코드가 쓰는 컬럼이 다 있는지
4. 실시간 구독: Realtime에 테이블이 등록됐는지
5. 쓰기 테스트(버튼): 접수 넣기, 실시간 알림 받기, 진료 완료 처리까지 한 번에 확인

평소에는 각 화면의 상태 표시로 확인할 수 있습니다. 교사 대시보드는 오른쪽 위, 학생 화면은 맨 아래에 있습니다.

| 표시 | 의미 |
| --- | --- |
| 초록 "실시간 연결됨" | 정상 |
| 주황 "실시간 끊김 (15초마다 새로고침)" | 실시간 구독은 안 되지만 15초마다 다시 불러오고 있어서 화면은 계속 갱신됩니다 |
| 빨강 "서버 연결 오류" 또는 "설정 오류" | 데이터를 못 불러오는 상태입니다. 교사 대시보드에는 원인이 안내문으로 뜹니다 |

브라우저 개발자 도구 콘솔에도 `[보건실]`로 시작하는 메시지로 원인이 찍힙니다.

## 알아둘 점

지금 구조는 로그인 없이 Publishable 키 하나로 동작합니다. 그래서 사이트에 들어온 누구나 브라우저 개발자 도구로 접수 목록의 이름, 학번, 방문 사유를 읽을 수 있고, 진료 완료 처리도 할 수 있습니다. 보건실 방문 기록은 민감한 개인정보라서 실제 학교에서 쓰려면 교사 화면에 Supabase Auth 로그인을 붙이고, 학생 화면은 대기 인원과 시간 합계만 돌려주는 함수(RPC)를 쓰도록 바꿔야 합니다. 시연할 때는 실명 대신 가명 데이터를 쓰는 것을 권합니다.
