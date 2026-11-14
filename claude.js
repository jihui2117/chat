import { content, fitHistory } from "./chat-core.js";

const messagesUrl = "https://api.anthropic.com/v1/messages";
const prices = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.10 },
  "claude-haiku-5-5": { input: 0.10, output: 0.50, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.20 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.20 },
};

async function post(apiKey, path, body, timeout) {
  let response;
  try {
    response = await fetch(messagesUrl + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (cause) {
    throw new Error(cause.name === "TimeoutError"
      ? "Claude 요청 시간이 초과됐어요. 잠시 후 다시 시도해 주세요."
      : "Claude API에 연결하지 못했어요. 네트워크와 조직의 브라우저 API 호출 허용 여부를 확인해 주세요.");
  }
  const data = await response.json().catch(() => null);
  if (response.ok && data) return data;
  if (response.status === 401 && /^CORS requests are not allowed/i.test(data?.error?.message ?? "")) {
    throw new Error("이 Claude 조직에서는 브라우저에서 API를 직접 호출할 수 없어요.");
  }
  if (/credit balance|billing|payment/i.test(data?.error?.message ?? "")) {
    throw new Error("Claude Console에서 API 잔액과 결제 설정을 확인해 주세요.");
  }
  const errors = {
    400: "Claude API가 요청을 거절했어요. 입력 길이와 선택한 모델을 확인해 주세요.",
    401: "Claude API 키가 유효한지 확인해 주세요.",
    403: "이 Claude API 키에 선택한 모델을 호출할 권한이 없어요.",
    404: "이 Claude API 키로 선택한 모델을 사용할 수 없어요.",
    429: "Claude API 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
    529: "Claude API가 혼잡해요. 잠시 후 다시 시도해 주세요.",
  };
  throw new Error(errors[response.status] ?? `Claude API 응답을 처리하지 못했어요 (HTTP ${response.status}).`);
}

function messagesFrom(contents) {
  return contents.map(({ role, parts }) => ({
    role: role === "model" ? "assistant" : "user",
    content: parts.map(({ text }) => text).join(""),
  }));
}

function measureUsage(usage, model) {
  const inputTokens = usage?.input_tokens;
  const output = Number.isSafeInteger(usage?.output_tokens) ? usage.output_tokens : null;
  if (!Number.isSafeInteger(inputTokens)) return { input: null, output, usd: null };
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens
    ?? (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) + write1h;
  const input = inputTokens + cacheRead + cacheWrite;
  const rates = model === "claude-haiku-5-5" && input > 100_000
    ? { input: 0.50, output: 2.50, cacheRead: 0.05 }
    : prices[model];
  const usd = output === null ? null : (
    inputTokens * rates.input +
    cacheRead * rates.cacheRead +
    (cacheWrite - write1h) * rates.input * 1.25 +
    write1h * rates.input * 2 +
    output * rates.output
  ) / 1_000_000;
  return { input, output, usd };
}

export async function askClaude({ apiKey, model, thinkingLevel, turns, prompt, instructions, onGenerating }) {
  const contents = await fitHistory(turns, content("user", prompt), async (history) => {
    const count = await post(apiKey, "/count_tokens", { model, messages: messagesFrom(history) }, 30_000);
    if (!Number.isSafeInteger(count.input_tokens)) throw new Error("Claude 입력 토큰 수를 확인할 수 없었어요.");
    return count.input_tokens;
  });

  onGenerating();
  const request = { model, messages: messagesFrom(contents), max_tokens: 8192 };
  if (instructions) request.system = instructions;
  if (thinkingLevel) {
    request.thinking = { type: "adaptive" };
    request.output_config = { effort: thinkingLevel.toLowerCase() };
  }
  const response = await post(apiKey, "", request, 300_000);
  const answer = response.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  return { answer, usage: measureUsage(response.usage, model) };
}
