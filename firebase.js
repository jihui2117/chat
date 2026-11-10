import { content, fitHistory, measureUsage } from "./chat-core.js";

const cdn = "https://www.gstatic.com/firebasejs/12.19.0";
let service;

function getService(config, debug) {
  service ??= initialize(config, debug).catch((error) => {
    service = undefined;
    throw error;
  });
  return service;
}

async function initialize(config, debug) {
  const [appSdk, checkSdk, aiSdk] = await Promise.all([
    import(`${cdn}/firebase-app.js`),
    import(`${cdn}/firebase-app-check.js`),
    import(`${cdn}/firebase-ai.js`),
  ]);
  const { projectId, appId, apiKey, siteKey } = config;
  const app = appSdk.getApps()[0] ?? appSdk.initializeApp({ projectId, appId, apiKey });
  if (debug.enabled) self.FIREBASE_APPCHECK_DEBUG_TOKEN = debug.token || true;
  const appCheck = checkSdk.initializeAppCheck(app, {
    // In SDK debug mode the provider is bypassed. The placeholder is only
    // reachable on loopback when the user enables local debug mode.
    provider: new checkSdk.ReCaptchaEnterpriseProvider(siteKey || "local-debug"),
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

export async function ask({ config, debug, model, thinkingLevel, turns, prompt, onText, onGenerating }) {
  const { ai, getModel, ThinkingLevel, appCheck, getToken } = await getService(config, debug);
  // Give App Check its own error before sending a request to AI Logic.
  try {
    await getToken(appCheck);
  } catch {
    throw new Error("app-check");
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
