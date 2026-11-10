# 아르곤 챗

Firebase AI Logic을 연결해 GitHub Pages에서 쓸 수 있는 한국어 채팅 앱입니다. 별도 빌드 없이 동작합니다.

- Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro Preview를 채팅 중에도 선택할 수 있습니다.
- 채팅과 사용량은 브라우저의 IndexedDB에 저장됩니다. 대화 기록은 브라우저마다 따로 유지됩니다.
- 이전 대화는 최근 20턴 중에서 최대 10,000토큰에 들어오는 범위까지 모델에 보냅니다. 현재 질문은 별도로 포함하고 응답 상한은 8,192토큰입니다.
- 채팅별 입력·출력 토큰, 표준 요금 기준의 누적 USD 예상 비용, 최신 일일 USD/KRW 기준환율과 조회 시각을 표시합니다. 사고·캐시 토큰이 비용에 반영되고, 이미 저장한 비용은 환율만 새로 적용됩니다.

## Firebase 연결

1. Firebase 콘솔에 웹 앱을 추가하고 **AI 서비스 → AI Logic**에서 제공자를 설정합니다. `vertex`는 Agent Platform(구 Vertex AI)의 `global` 리전을, `developer`는 Gemini Developer API를 사용합니다. Argon과 3.1 Pro Preview에는 결제가 필요합니다. Spark에서는 3.8 Flash만 선택할 수 있습니다. 제공자의 약관과 프로젝트의 모델 이용 가능 여부를 확인하세요.
2. 공개 사이트에서는 [App Check용 reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)를 설정합니다. reCAPTCHA에 실제 호스트 이름(예: `OWNER.github.io`)을 등록하고, Firebase 콘솔에서 해당 웹 앱을 App Check에 등록한 뒤 **AI Logic**에 적용합니다.
3. `config.js`에 Firebase 웹 설정의 `projectId`, `appId`, `apiKey`와 reCAPTCHA Enterprise 공개 `siteKey`를 입력합니다. `backend`와 `plan`을 프로젝트와 일치시키면 방문자는 링크를 열어 바로 쓸 수 있습니다. 공개 웹 설정은 Firebase 전용으로 제한된 키를 사용하세요.
4. ZIP 안의 파일을 GitHub 저장소 루트에 올립니다. 저장소의 **Settings → Pages → Deploy from a branch**에서 브랜치와 `/ (root)`를 선택합니다. 프로젝트 경로 아래에서도 동작하도록 파일 경로는 상대 경로로 구성했습니다.

공개 링크를 통해 누구나 해당 프로젝트의 모델을 호출할 수 있으므로 Firebase의 [요청 한도](https://firebase.google.com/docs/ai-logic/quotas)와 제공자의 결제·사용량 제한을 배포 전에 설정하세요. App Check는 앱 요청을 검증하며 방문자 계정 확인은 하지 않습니다.

## 내 브라우저에서 연결하거나 테스트하기

1. 이 폴더에서 `python3 -m http.server 8080`을 실행하고 [http://localhost:8080](http://localhost:8080)을 엽니다.
2. **연결 설정**에서 Firebase 웹 설정값을 입력합니다. 여기서 변경한 값은 현재 브라우저에만 적용됩니다. **배포 설정 사용**으로 `config.js`의 설정을 다시 사용할 수 있습니다.
3. 로컬에서 **App Check 디버그 모드**를 켠 뒤 Firebase 콘솔에 등록한 토큰을 입력합니다. 필드를 비워두면 첫 모델 요청 때 개발자 도구 콘솔에 토큰이 표시됩니다. Firebase 콘솔의 **App Check → 앱 → 디버그 토큰 관리**에서 등록하고 다시 시도하세요. 앱에 직접 입력한 토큰은 탭 세션에 보관되며 Firebase SDK가 생성한 토큰은 SDK의 로컬 저장소에서 관리합니다.
4. 배포용 설정과 GitHub 저장소에는 App Check 디버그 토큰이나 Gemini 비밀 키를 넣지 마세요.

## 비용과 환율

비용은 [Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing)와 [Agent Platform](https://cloud.google.com/model-garden/pricing)의 텍스트 표준 요금표를 사용합니다. 모델별 공지된 가격 전환일은 UTC 기준으로 반영합니다. 앱의 금액에는 개별 결제 할인이나 세금이 반영되지 않습니다. 최종 청구액은 클라우드 청구서에서 확인하세요.

환율은 [Frankfurter](https://frankfurter.dev/v1/)의 최신 영업일 기준값을 사용합니다. 새로고침 버튼으로 다시 조회할 수 있으며, 실패하면 이 브라우저에서 마지막으로 받은 환율을 표시합니다.
