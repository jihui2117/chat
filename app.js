import { defaultModel, maxPromptChars, models, totals } from "./chat-core.js";
import { ask } from "./firebase.js";
import { askClaude } from "./claude.js";
import { askOpenRouter } from "./openrouter.js";
import { deleteChat, readChats, readSetting, saveChat, writeSetting } from "./storage.js";

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "history", "new-chat", "chat-title", "provider", "model", "thinking-level", "input-tokens", "output-tokens",
  "cost-usd", "cost-krw", "rate", "rate-date", "refresh-rate", "usage-note", "conversation",
  "empty", "messages", "compose", "prompt", "send", "status", "sidebar", "menu", "backdrop",
  "settings", "settings-form", "settings-error", "open-settings", "gemini-settings", "claude-settings",
  "openrouter-settings", "empty-settings", "close-settings", "reset-settings", "history-hint",
].map((id) => [id, byId(id)]));

const { debugToken = "", ...sessionConfig } = readSetting("personal-connection", true) ?? {};
const config = { backend: "vertex", plan: "blaze", ...readSetting("firebase"), ...sessionConfig };
if (config.backend === "vertex") config.plan = "blaze";
const geminiConfigured = Boolean(config.projectId && config.appId && config.apiKey && debugToken);
const keyConnections = {
  claude: {
    label: "Claude",
    field: "claudeKey",
    pattern: /^sk-ant-[A-Za-z0-9_-]+$/,
    invalidKey: "Claude Console에서 발급한 API 키를 입력해 주세요.",
    ask: askClaude,
  },
  openrouter: {
    label: "OpenRouter",
    field: "openrouterKey",
    pattern: /^sk-or-v1-[A-Za-z0-9_-]+$/,
    invalidKey: "OpenRouter에서 발급한 API 키를 입력해 주세요.",
    ask: askOpenRouter,
  },
};
for (const [provider, connection] of Object.entries(keyConnections)) {
  connection.setting = `${provider}-key`;
  connection.key = readSetting(connection.setting, true) ?? "";
}
const savedModel = readSetting("model");
const selectedModels = {
  gemini: models.find(({ id, provider }) => id === savedModel && provider === "gemini")?.id ?? defaultModel,
  claude: models.find(({ id, provider }) => id === savedModel && provider === "claude")?.id ?? "claude-sonnet-5-5",
  openrouter: models.find(({ id, provider }) => id === savedModel && provider === "openrouter")?.id ?? "anthropic/claude-haiku-5.5",
};
const nf = new Intl.NumberFormat("ko-KR");
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency", currency: "KRW", maximumFractionDigits: 2,
});
const checkedAtFormat = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
});

let chats = [];
let current = newChat();
let busy = false;
let storageReady = true;
let fx = readSetting("exchange");
let fxStatus = "";

function newChat() {
  return { id: crypto.randomUUID(), title: "새 채팅", updatedAt: 0, turns: [] };
}

function announce(text, error = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", error);
}

function setSidebar(open) {
  ui.sidebar.classList.toggle("open", open);
  ui.backdrop.hidden = !open;
  ui.menu.setAttribute("aria-expanded", String(open));
}

function renderHistory() {
  ui.history.replaceChildren();
  if (chats.length === 0) {
    const item = document.createElement("li");
    item.className = "no-history";
    item.textContent = "저장된 채팅이 여기에 표시됩니다.";
    ui.history.append(item);
    return;
  }
  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const item = document.createElement("li");
    const select = document.createElement("button");
    select.type = "button";
    select.className = "history-item";
    select.disabled = busy;
    if (chat.id === current.id) select.setAttribute("aria-current", "true");
    const label = document.createElement("span");
    label.textContent = chat.title;
    select.append(icon("chat"), label);
    select.title = chat.title;
    select.addEventListener("click", () => {
      current = chat;
      ui.prompt.value = "";
      announce("");
      setSidebar(false);
      render();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.disabled = busy;
    remove.setAttribute("aria-label", `${chat.title} 삭제`);
    remove.append(icon("trash"));
    remove.addEventListener("click", async () => {
      if (!window.confirm("이 채팅을 이 브라우저에서 삭제할까요?")) return;
      try {
        if (storageReady) await deleteChat(chat.id);
        chats = chats.filter((entry) => entry.id !== chat.id);
        if (current.id === chat.id) current = newChat();
        render();
      } catch {
        announce("채팅을 삭제하지 못했어요.", true);
      }
    });
    item.append(select, remove);
    ui.history.append(item);
  }
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}

function renderUsage() {
  const usage = totals(current.turns);
  const formatTotal = (metric, format) => {
    const missing = usage.missing[metric];
    if (missing && missing === current.turns.length) return "—";
    return `${missing ? "≥ " : ""}${format(usage[metric])}`;
  };
  ui["input-tokens"].textContent = formatTotal("input", nf.format);
  ui["output-tokens"].textContent = formatTotal("output", nf.format);
  ui["cost-usd"].textContent = formatTotal("usd", (value) => `$${value.toFixed(6)}`);
  ui["cost-krw"].textContent = fx
    ? formatTotal("usd", (value) => `${usage.missing.usd ? "" : "≈ "}${won.format(value * fx.rate)}`)
    : "원화 환산 대기";
  ui.rate.textContent = fx ? `₩${nf.format(fx.rate)} / $1` : fxStatus || "불러오는 중";
  ui["rate-date"].textContent = fx
    ? `${fx.date} 기준 · ${fxStatus || checkedAtFormat.format(fx.checkedAt) + " KST 조회"}`
    : "";
  const notes = [];
  if (usage.thinking) notes.push(`확인된 사고 토큰 ${nf.format(usage.thinking)}개`);
  if (usage.missing.usd) notes.push(`${nf.format(usage.missing.usd)}개 응답의 사용량 미집계`);
  ui["usage-note"].textContent = notes.join(" · ");
  ui["usage-note"].hidden = notes.length === 0;
}

function addMessage(role, title, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const label = document.createElement("strong");
  label.textContent = title;
  const bubble = document.createElement("p");
  bubble.className = "bubble";
  bubble.textContent = text;
  article.append(label, bubble);
  ui.messages.append(article);
  return bubble;
}

function renderModels(modelId) {
  ui.model.replaceChildren();
  for (const model of models.filter(({ provider }) => provider === ui.provider.value)) {
    const option = new Option(model.label, model.id);
    if (model.provider === "gemini" && config.plan === "spark" && model.paid) {
      option.disabled = true;
      option.textContent += " · Blaze 필요";
    }
    ui.model.append(option);
  }
  const enabled = Array.from(ui.model.options).filter((option) => !option.disabled);
  ui.model.value = enabled.find((option) => option.value === modelId)?.value ?? enabled[0].value;
  ui["history-hint"].textContent = ui.provider.value === "openrouter"
    ? "최근 20턴 · 이전 대화 토큰 수는 브라우저에서 추정"
    : "최근 20턴 · 이전 대화 최대 10,000토큰";
  renderConnectionButton();
}

function renderConnectionButton() {
  const connection = keyConnections[ui.provider.value];
  ui["empty-settings"].hidden = connection ? Boolean(connection.key) : geminiConfigured;
  ui["empty-settings"].textContent = `${connection?.label ?? "Firebase"} 연결 설정`;
}

function render({ preserveModel = false } = {}) {
  ui["chat-title"].textContent = current.title;
  if (!preserveModel) {
    const modelId = current.turns.at(-1)?.model ?? readSetting("model") ?? defaultModel;
    ui.provider.value = models.find(({ id }) => id === modelId)?.provider ?? "gemini";
    renderModels(modelId);
  }
  ui.empty.hidden = current.turns.length > 0;
  ui.messages.replaceChildren();
  for (const turn of current.turns) {
    addMessage("user", "나", turn.prompt);
    addMessage("model", models.find((model) => model.id === turn.model)?.label ?? turn.model,
      turn.answer || "모델에서 표시할 답변을 반환하지 않았어요.");
  }
  renderHistory();
  renderUsage();
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
}

async function fetchRate() {
  ui["refresh-rate"].disabled = true;
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW", {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("exchange-http");
    const data = await response.json();
    if (!Number.isFinite(data.rates?.KRW) || data.rates.KRW <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("exchange-data");
    fx = { rate: data.rates.KRW, date: data.date, checkedAt: Date.now() };
    fxStatus = "";
    try { writeSetting("exchange", fx); } catch { /* Current rate remains available. */ }
  } catch {
    fxStatus = fx ? "이전 조회값" : "조회 실패";
  } finally {
    ui["refresh-rate"].disabled = false;
    renderUsage();
  }
}

function setBusy(value) {
  busy = value;
  for (const key of ["provider", "model", "thinking-level", "new-chat", "open-settings", "send"]) {
    ui[key].disabled = value;
  }
  renderHistory();
}

function errorMessage(error) {
  const details = String(error?.message ?? "");
  if (details === "app-check") {
    const code = error.cause?.code;
    const httpStatus = Number(error.cause?.customData?.httpStatus);
    const diagnostics = [
      /^appCheck\/[a-z-]+$/i.test(code) ? code : "",
      Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? `HTTP ${httpStatus}` : "",
    ].filter(Boolean).join(" · ");
    const headline = `App Check 인증이 실패했어요${diagnostics ? ` (${diagnostics})` : ""}.`;
    if (code === "appCheck/fetch-network-error") {
      return `${headline} 브라우저에서 Firebase App Check에 연결하지 못했어요.`;
    }
    return `${headline} Firebase 콘솔의 이 웹 앱에 등록된 디버그 토큰과 연결 설정의 웹 앱 ID를 확인해 주세요.`;
  }
  if (details === "token-count") return "이전 대화의 토큰 수를 확인할 수 없었어요. 잠시 후 다시 시도해 주세요.";
  if (/429|quota|resource.exhausted/i.test(details)) return "Firebase 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.";
  if (/404|not.found/i.test(details)) return "이 Firebase 프로젝트에서 선택한 모델을 찾을 수 없어요.";
  if (/403|denied|401|billing/i.test(details)) return "모델 호출 권한이 없어요. Firebase AI Logic, 모델 이용 권한, 요금제를 확인해 주세요.";
  if (/blocked|safety/i.test(details)) return "안전 필터로 응답을 표시할 수 없어요. 질문을 바꿔 다시 시도해 주세요.";
  return "모델에 연결하지 못했어요. 연결 설정과 네트워크를 확인한 뒤 다시 시도해 주세요.";
}

async function remember(turn) {
  const updated = {
    ...current,
    title: current.turns.length ? current.title : turn.prompt.replace(/\s+/g, " ").slice(0, 48),
    updatedAt: Date.now(),
    turns: [...current.turns, turn],
  };
  let saved = false;
  try {
    if (storageReady) {
      current = await saveChat(updated);
      saved = true;
    }
  } catch { /* Keep the result visible even if the browser rejects the write. */ }
  if (!saved) current = updated;
  chats = [...chats.filter((entry) => entry.id !== current.id), current];
  return saved;
}

async function send(event) {
  event.preventDefault();
  const prompt = ui.prompt.value.trim();
  if (busy || !prompt) return;
  const model = models.find((entry) => entry.id === ui.model.value);
  if (!model || ui.model.selectedOptions[0]?.disabled) return;
  const connection = keyConnections[model.provider];
  if (connection ? !connection.key : !geminiConfigured) {
    openSettings();
    return;
  }

  const thinkingLevel = ui["thinking-level"].value;
  const turn = { id: crypto.randomUUID(), model: model.id, prompt, answer: "", usage: null };
  setBusy(true);
  ui.prompt.value = "";
  ui.empty.hidden = true;
  addMessage("user", "나", prompt);
  addMessage("model", model.label, "연결 중…");
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
  announce("연결과 이전 대화를 확인하는 중…");
  try {
    const request = {
      model: model.id, thinkingLevel, turns: current.turns, prompt,
      onGenerating: () => announce("답변을 생성하는 중…"),
    };
    const reply = connection
      ? await connection.ask({ ...request, apiKey: connection.key })
      : await ask({ ...request, config, debugToken });
    Object.assign(turn, reply);
    const saved = await remember(turn);
    announce(saved ? "" : "브라우저 저장에 실패했어요. 현재 탭에서만 대화가 유지됩니다.", !saved);
  } catch (error) {
    if (!ui.prompt.value) ui.prompt.value = prompt;
    announce(connection ? error.message : errorMessage(error), true);
  } finally {
    setBusy(false);
    render({ preserveModel: true });
  }
}

const fields = ui["settings-form"].elements;
const configFields = ["projectId", "appId", "apiKey", "backend", "plan"];
function updateSettingsForm() {
  for (const provider of ["gemini", "claude", "openrouter"]) {
    const fieldset = ui[`${provider}-settings`];
    fieldset.hidden = fieldset.disabled = fields.provider.value !== provider;
  }
  if (fields.backend.value === "vertex") fields.plan.value = "blaze";
  fields.plan.disabled = fields.backend.value === "vertex";
  ui["settings-error"].textContent = "";
}

function openSettings() {
  if (busy) return;
  for (const name of configFields) {
    fields[name].value = config[name] ?? "";
  }
  fields.provider.value = ui.provider.value;
  fields.debugToken.value = debugToken;
  for (const { field, key } of Object.values(keyConnections)) fields[field].value = key;
  updateSettingsForm();
  ui.settings.showModal();
}

function saveSettings(event) {
  event.preventDefault();
  const provider = fields.provider.value;
  const connection = keyConnections[provider];
  if (connection) {
    const key = fields[connection.field].value.trim();
    if (!connection.pattern.test(key)) {
      ui["settings-error"].textContent = connection.invalidKey;
      return;
    }
    try {
      writeSetting(connection.setting, key, true);
    } catch {
      ui["settings-error"].textContent = `이 탭에 ${connection.label} API 키를 저장할 수 없어요.`;
      return;
    }
    connection.key = key;
    selectProvider(provider);
    ui.settings.close();
    return;
  }
  const updated = Object.fromEntries(configFields.map((name) => [name, fields[name].value.trim()]));
  const token = fields.debugToken.value.trim();
  if (!updated.projectId || !updated.appId || !updated.apiKey || !token) {
    ui["settings-error"].textContent = "프로젝트 ID, 웹 앱 ID, Firebase 웹 API 키, 디버그 토큰을 모두 입력해 주세요.";
    return;
  }
  try {
    // Keep the token and its Firebase app together even if another tab edits its settings.
    writeSetting("personal-connection", { ...updated, debugToken: token }, true);
  } catch {
    ui["settings-error"].textContent = "이 탭에 연결 설정을 저장할 수 없어요.";
    return;
  }
  try { writeSetting("firebase", updated); } catch { /* The connection is saved for this tab. */ }
  selectProvider("gemini");
  location.reload();
}

function rememberModel() {
  selectedModels[ui.provider.value] = ui.model.value;
  try { writeSetting("model", ui.model.value); } catch { /* Selection still applies in this tab. */ }
}

function selectProvider(provider) {
  ui.provider.value = provider;
  renderModels(selectedModels[provider]);
  rememberModel();
  announce("");
}

async function start() {
  ui.prompt.maxLength = maxPromptChars;
  const thinking = ui["thinking-level"];
  const savedThinking = readSetting("thinking-level");
  if (Array.from(thinking.options).some((option) => option.value === savedThinking)) {
    thinking.value = savedThinking;
  }
  thinking.addEventListener("change", () => {
    try { writeSetting("thinking-level", thinking.value); } catch { /* Selection still applies to the next message. */ }
  });
  ui.provider.addEventListener("change", () => selectProvider(ui.provider.value));
  ui.model.addEventListener("change", rememberModel);
  ui["new-chat"].addEventListener("click", () => {
    current = newChat();
    ui.prompt.value = "";
    announce("");
    setSidebar(false);
    render();
    ui.prompt.focus();
  });
  ui.menu.addEventListener("click", () => setSidebar(!ui.sidebar.classList.contains("open")));
  ui.backdrop.addEventListener("click", () => { setSidebar(false); ui.menu.focus(); });
  ui["refresh-rate"].addEventListener("click", fetchRate);
  ui["open-settings"].addEventListener("click", openSettings);
  ui["empty-settings"].addEventListener("click", openSettings);
  ui["close-settings"].addEventListener("click", () => ui.settings.close());
  ui["settings-form"].addEventListener("submit", saveSettings);
  fields.provider.addEventListener("change", updateSettingsForm);
  fields.backend.addEventListener("change", updateSettingsForm);
  ui["reset-settings"].addEventListener("click", () => {
    try {
      const connection = keyConnections[fields.provider.value];
      if (connection) {
        writeSetting(connection.setting, null, true);
        connection.key = "";
        fields[connection.field].value = "";
        renderConnectionButton();
        ui["settings-error"].textContent = "";
        ui.settings.close();
        return;
      }
      writeSetting("personal-connection", null, true);
      writeSetting("firebase", null);
    } catch {
      ui["settings-error"].textContent = "이 브라우저에서 저장된 설정을 지울 수 없어요.";
      return;
    }
    location.reload();
  });
  ui.compose.addEventListener("submit", send);
  ui.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      ui.compose.requestSubmit();
    }
  });

  setBusy(true);
  try {
    chats = await readChats();
  } catch {
    storageReady = false;
    announce("이 브라우저에서 대화 저장을 사용할 수 없어요.", true);
  }
  setBusy(false);
  render();
  void fetchRate();
}

void start();
