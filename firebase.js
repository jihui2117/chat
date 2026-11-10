import { content, fitHistory, measureUsage } from "./chat-core.js";

const cdn = "https://www.gstatic.com/firebasejs/12.19.0";
let service;
let verifiedDebugToken = false;

function getService(config, debugToken) {
  service ??= initialize(config, debugToken).catch((error) => {
    service = undefined;
    throw error;
  });
  return service;
}

async function initialize(config, debugToken) {
  const [appSdk, checkSdk, aiSdk] = await Promise.all([
    import(`${cdn}/firebase-app.js`),
    import(`${cdn}/firebase-app-check.js`),
    import(`${cdn}/firebase-ai.js`),
  ]);
  const { projectId, appId, apiKey } = config;
  const app = appSdk.getApps()[0] ?? appSdk.initializeApp({ projectId, appId, apiKey });
  const appCheck = checkSdk.initializeAppCheck(app, {
    // Use the official debug exchange without enabling the SDK's console logging
    // of the debug token. Only the returned App Check token goes to the SDK.
    provider: new checkSdk.CustomProvider({ getToken: () => exchangeDebugToken(config, debugToken) }),
    isTokenAutoRefreshEnabled: true,
  });
  const AgentPlatformBackend = aiSdk.AgentPlatformBackend ?? aiSdk.VertexAIBackend;
  const backend = config.backend === "vertex"
    ? new AgentPlatformBackend("global")
    : new aiSdk.GoogleAIBackend();
  const ai = aiSdk.getAI(app, { backend });
  return {
    appCheck, getToken: checkSdk.getToken, ai,
    getModel: aiSdk.getGenerativeModel, ThinkingLevel: aiSdk.ThinkingLevel,
  };
}

async function exchangeDebugToken({ projectId, appId, apiKey }, debugToken) {
  const app = `projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}`;
  const url = new URL(`https://firebaseappcheck.googleapis.com/v1/${app}:exchangeDebugToken`);
  url.searchParams.set("key", apiKey);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debugToken }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw Object.assign(new Error("App Check could not reach Firebase"), {
      code: "appCheck/fetch-network-error",
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Firebase rejected the App Check debug token request"), {
      code: "appCheck/fetch-status-error",
      customData: { httpStatus: response.status },
    });
  }
  const { token, ttl } = await response.json();
  const ttlMs = /^\d+(?:\.\d+)?s$/.test(ttl) ? Number(ttl.slice(0, -1)) * 1000 : 0;
  const expireTimeMillis = startedAt + ttlMs;
  if (typeof token !== "string" || !token || !Number.isFinite(ttlMs) || expireTimeMillis <= Date.now()) {
    throw new Error("Firebase returned an invalid App Check token response");
  }
  return { token, expireTimeMillis };
}

export async function ask({ config, debugToken, model, thinkingLevel, turns, prompt, onText, onGenerating }) {
  const { ai, getModel, ThinkingLevel, appCheck, getToken } = await getService(config, debugToken);
  // Give App Check its own error before sending a request to AI Logic.
  try {
    await getToken(appCheck, !verifiedDebugToken);
    verifiedDebugToken = true;
  } catch (cause) {
    throw new Error("app-check", { cause });
  }
  const generationConfig = { maxOutputTokens: 8192 };
  if (thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: ThinkingLevel[thinkingLevel] };
  }
  const generator = getModel(ai, { model, generationConfig });
  const contents = await fitHistory(turns, content("user", prompt), async (messages) => {
    const count = await generator.countTokens({ contents: messages });
    if (!Number.isFinite(count.totalTokens)) throw new Error("token-count");
    return count.totalTokens;
  });

  onGenerating();
  const requestDate = new Date().toISOString().slice(0, 10);
  const { stream, response } = await generator.generateContentStream({ contents });
  // Observe both promises even when the stream fails before the final response.
  void response.catch(() => {});
  let text = "";
  for await (const chunk of stream) {
    const delta = chunk.candidates?.[0]?.content?.parts?.length ? chunk.text() : "";
    if (delta) {
      text += delta;
      onText(text);
    }
  }
  const final = await response;
  const hasFinalParts = final.candidates?.[0]?.content?.parts?.length;
  const answer = text || (hasFinalParts ? final.text() : "");
  const usage = measureUsage(final.usageMetadata, model, config.plan, requestDate);
  return { answer, usage };
}
