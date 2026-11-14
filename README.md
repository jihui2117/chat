# 아르곤 챗

Gemini와 Claude를 지원하는 한국어 채팅 앱입니다. Claude는 Anthropic에 직접 연결하거나 OpenRouter를 통해 사용할 수 있습니다. 각자 자신의 API 연결 정보를 입력해 사용하며, 별도 빌드 없이 GitHub Pages에 올릴 수 있습니다.

- Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro Preview를 채팅 중에도 선택할 수 있습니다.
- Claude와 OpenRouter에서는 Sonnet 5.5, Haiku 5.5, Opus 5.5, Fable 5.2 중에서 고를 수 있습니다.
- 추론 단계는 모델 기본값, 낮음, 중간, 높음 중에서 선택할 수 있습니다. 선택값은 이 브라우저에 저장되고 다음 요청부터 적용됩니다.
- 모바일에서는 줄바꿈 키로 여러 줄을 입력하고 전송 버튼을 눌러 보냅니다. 데스크톱에서는 Enter로 전송하고 Shift+Enter로 줄을 바꿉니다.
- 답변 아래의 **답변 복사**로 답변 전체를 복사합니다. 줄바꿈과 마크다운 기호가 유지됩니다.
- 채팅과 사용량은 브라우저의 IndexedDB에 저장됩니다. 대화 기록은 브라우저마다 따로 유지됩니다.
- 이전 대화는 최근 20턴 중에서 최대 10,000토큰에 들어오는 범위까지 모델에 보냅니다. OpenRouter에서는 브라우저가 UTF-8 바이트 수로 이전 대화 길이를 보수적으로 추정합니다. 현재 질문은 별도로 포함하고 응답 상한은 8,192토큰입니다.
- 채팅별 입력·출력 토큰, 누적 USD 비용, 최신 일일 USD/KRW 기준환율과 조회 시각을 표시합니다. 이미 저장한 비용은 환율만 새로 적용됩니다.

## 채팅 지침

상단의 **채팅 지침**에서 **공통 지침**과 **이 채팅의 지침**을 각각 저장할 수 있습니다. 공통 지침은 이 브라우저의 모든 채팅에서 사용합니다. 이 채팅의 지침은 해당 대화에 저장되며 새 채팅에서는 빈칸으로 시작합니다.

채팅별 첫 요청과 21번째, 41번째 요청처럼 20턴마다 저장된 지침을 모델에 함께 보냅니다. 지침은 별도 API 호출 없이 해당 요청의 입력 토큰에 포함됩니다.

## 각자 Firebase 연결하기

1. 본인 소유의 테스트용 Firebase 프로젝트에 웹 앱을 추가합니다. **AI 서비스 → AI Logic**에서 사용할 제공자를 설정합니다. Argon과 3.1 Pro Preview에는 결제가 필요합니다. Spark에서는 3.8 Flash만 선택할 수 있습니다.
2. **프로젝트 설정 → 일반 → 내 앱**에서 해당 웹 앱의 웹 설정을 확인합니다. 앱의 **연결 설정**에 `projectId`, `appId`, `apiKey`를 각각 입력합니다. 이때 `apiKey`는 Firebase 웹 설정값입니다.
3. 같은 웹 앱의 **Firebase 콘솔 → App Check → 앱 → ⋮ → 디버그 토큰 관리**에서 디버그 토큰을 추가합니다. 등록 직후 표시된 토큰을 복사해 채팅 앱의 **App Check 디버그 토큰**에 입력합니다. 이 앱은 [App Check 디버그 제공업체](https://firebase.google.com/docs/app-check/web/debug-provider)를 사용합니다.
4. 프로젝트에서 설정한 AI 제공자와 요금제를 선택하고 **저장 및 적용**을 누릅니다. 모델 사용량은 연결한 본인의 프로젝트에 기록됩니다.

Firebase 웹 설정은 브라우저에, 디버그 토큰은 입력한 탭 세션에 저장됩니다. 새로고침해도 같은 탭 세션에서는 연결을 다시 사용할 수 있습니다. **연결 설정 지우기**로 현재 탭의 연결과 저장한 웹 설정을 지울 수 있습니다. 토큰은 비밀값이므로 본인의 테스트 프로젝트에서만 사용하고 GitHub 파일이나 메시지에 붙여넣지 마세요.

## GitHub Pages에 올리기

ZIP 안의 파일을 GitHub 저장소 루트에 올립니다. 저장소의 **Settings → Pages → Deploy from a branch**에서 브랜치와 `/ (root)`를 선택합니다. Claude 직접 연결이 있는 버전에 OpenRouter를 추가하려면 `index.html`, `app.js`, `chat-core.js`를 교체하고 `openrouter.js`를 추가합니다.

## Claude 연결하기

1. Claude Console에서 본인의 API 키를 발급받습니다.
2. 채팅 화면 상단의 **AI 서비스 → Claude**를 선택하고 **연결 설정**에서 키를 입력합니다.
3. **저장 및 적용**을 누른 뒤 모델과 추론 단계를 선택합니다.

Claude 키는 입력한 탭의 세션에 저장됩니다. Claude를 선택하면 모델 요청과 대화 문맥이 브라우저에서 Anthropic API로 직접 전송됩니다. 브라우저 직접 호출을 허용하는 Claude 조직이 필요합니다. [Claude API 인증](https://platform.claude.com/docs/en/manage-claude/authentication)

## OpenRouter 연결하기

1. 본인의 OpenRouter 계정에서 [크레딧](https://openrouter.ai/settings/credits)을 충전하고 [API 키](https://openrouter.ai/settings/keys)를 발급받습니다.
2. 상단의 **AI 서비스 → OpenRouter**를 선택하고 **연결 설정**에서 OpenRouter 키를 입력합니다.
3. **저장 및 적용**을 누른 뒤 모델과 추론 단계를 선택합니다. 비용이 낮은 Haiku 5.5가 처음에 선택됩니다.

Claude 모델 사용료는 OpenRouter 크레딧에서 차감됩니다. 키는 현재 탭 세션에 저장되며 요청은 브라우저에서 OpenRouter API로 전송됩니다. **연결 설정 지우기**로 이 탭의 OpenRouter 키를 삭제할 수 있습니다. [OpenRouter 가격 안내](https://openrouter.ai/pricing)

## 비용과 환율

Gemini와 Anthropic 직접 연결의 예상 비용에는 제공업체별 텍스트 요금을 적용합니다. 모델별 공지된 가격 전환일은 UTC 기준으로 반영합니다. Claude 출력 합계에는 추론에 사용된 토큰도 포함됩니다. [Gemini Developer API 요금](https://ai.google.dev/gemini-api/docs/pricing) · [Agent Platform 요금](https://cloud.google.com/model-garden/pricing) · [Claude API 요금](https://platform.claude.com/docs/en/about-claude/pricing)

OpenRouter는 응답에 포함된 입력·출력 토큰 수와 요청별 크레딧 차감액을 표시합니다. 충전 수수료와 세금은 요청별 차감액에 포함되지 않습니다. [OpenRouter 사용량 집계](https://openrouter.ai/docs/cookbook/administration/usage-accounting)

환율은 [Frankfurter](https://frankfurter.dev/v1/)의 최신 영업일 기준값을 사용합니다. 새로고침 버튼으로 다시 조회할 수 있으며, 실패하면 이 브라우저에서 마지막으로 받은 환율을 표시합니다.
