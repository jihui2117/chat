import { content, fitHistory } from "./chat-core.js";

const completionsUrl = "https://openrouter.ai/api/v1/chat/completions";
const encoder = new TextEncoder();
const requestErrors = {
  400: "OpenRouter가 요청을 거절했어요. 입력 길이와 모델 설정을 확인해 주세요.",
  401: "OpenRouter API 키가 유효한지 확인해 주세요.",
  402: "OpenRouter 크레딧 또는 이 API 키의 사용 한도가 부족해요. 잔액과 키의 한도를 확인해 주세요.",
  403: "OpenRouter에서 이 요청을 허용하지 않았어요. 계정과 모델의 이용 권한을 확인해 주세요.",
  404: "OpenRouter에서 선택한 모델을 찾을 수 없어요.",
  429: "OpenRouter 요청이 많아요. 잠시 후 다시 시도해 주세요.",
  502: "선택한 모델 제공업체에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  503: "현재 OpenRouter에서 선택한 모델에 연결할 수 없어요.",
};

function nonnegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function askOpenRouter({ apiKey, model, thinkingLevel, turns, prompt, onGenerating }) {
  // Budget the history locally before sending a paid request. UTF-8 byte length
  // produces a conservative estimate for both Korean and English text.
  const contents = await fitHistory(turns, content("user", prompt), (history) =>
    history.reduce((size, { parts }) => size + 8 + encoder.encode(parts[0].text).length, 0));
  const request = {
    model,
    messages: contents.map(({ role, parts }) => ({
      role: role === "model" ? "assistant" : "user",
      content: parts[0].text,
    })),
    max_tokens: 8192,
  };
  if (thinkingLevel) request.reasoning = { effort: thinkingLevel.toLowerCase() };

  onGenerating();
  let response;
  let data;
  try {
    response = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
    });
    data = await response.json();
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error("OpenRouter 요청 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.");
    }
    if (!response) throw new Error("브라우저에서 OpenRouter에 연결하지 못했어요. 네트워크를 확인해 주세요.");
  }
  const choice = data?.choices?.[0];
  const error = data?.error ?? choice?.error;
  if (!response.ok || error) {
    const code = error?.code ?? response.status;
    throw new Error(requestErrors[code] ?? requestErrors[response.status] ?? "OpenRouter 요청을 처리하지 못했어요.");
  }
  if (!choice?.message) throw new Error("OpenRouter의 응답을 읽지 못했어요.");

  const { usage } = data;
  return {
    answer: typeof choice.message.content === "string" ? choice.message.content : "",
    usage: {
      input: nonnegative(usage?.prompt_tokens),
      output: nonnegative(usage?.completion_tokens),
      thinking: nonnegative(usage?.completion_tokens_details?.reasoning_tokens) ?? 0,
      usd: nonnegative(usage?.cost),
    },
  };
}
