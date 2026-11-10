import { deployment } from "./config.js";
import { defaultModel, maxPromptChars, models, totals } from "./chat-core.js";
import { ask } from "./firebase.js";
import { deleteChat, readChats, readSetting, saveChat, writeSetting } from "./storage.js";

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "history", "new-chat", "chat-title", "model", "input-tokens", "output-tokens",
  "cost-usd", "cost-krw", "rate", "rate-date", "refresh-rate", "usage-note", "conversation",
  "empty", "messages", "compose", "prompt", "send", "status", "sidebar", "menu", "backdrop",
  "settings", "settings-form", "settings-error", "debug-fields", "open-settings",
  "empty-settings", "close-settings", "reset-settings",
].map((id) => [id, byId(id)]));

const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const config = { ...deployment, ...readSetting("firebase") };
if (config.backend === "vertex") config.plan = "blaze";
const debug = loopback ? readSetting("debug", true) ?? {} : {};
const configured = Boolean(config.projectId && config.appId && config.apiKey && (config.siteKey || debug.enabled));
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
  ui["input-tokens"].textContent = nf.format(usage.input);
  ui["output-tokens"].textContent = nf.format(usage.output);
  ui["cost-usd"].textContent = `$${usage.usd.toFixed(6)}`;
  ui["cost-krw"].textContent = fx ? `≈ ${won.format(usage.usd * fx.rate)}` : "원화 환산 대기";
  ui.rate.textContent = fx ? `₩${nf.format(fx.rate)} / $1` : fxStatus || "불러오는 중";
  ui["rate-date"].textContent = fx
    ? `${fx.date} 기준 · ${fxStatus || checkedAtFormat.format(fx.checkedAt) + " KST 조회"}`
    : "";
  const notes = [];
  if (usage.thinking) notes.push(`사고 토큰 ${nf.format(usage.thinking)}개는 예상 비용에 반영`);
  if (usage.incomplete) notes.push("일부 응답의 사용량 미집계");
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

function render({ preserveModel = false } = {}) {
  ui["chat-title"].textContent = current.title;
  const previousModel = current.turns.at(-1)?.model;
  const lastModel = readSetting("model");
  const selection = [previousModel, lastModel, defaultModel].find((id) =>
    Array.from(ui.model.options).some((option) => option.value === id && !option.disabled));
  if (!preserveModel) ui.model.value = selection;
  ui.empty.hidden = current.turns.length > 0;
  ui["empty-settings"].hidden = configured;
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
  for (const key of ["model", "new-chat", "open-settings", "send"]) ui[key].disabled = value;
  renderHistory();
}

function errorMessage(error) {
  const details = String(error?.message ?? "");
  if (details === "app-check") {
    return loopback
      ? "App Check 인증이 실패했어요. 개발자 도구에서 발급된 토큰을 확인하고 Firebase 콘솔에 등록해 주세요."
      : "App Check 인증이 실패했어요. reCAPTCHA 사이트 키와 허용 도메인을 확인해 주세요.";
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
  if (!configured) {
    openSettings();
    return;
  }

  const model = models.find((entry) => entry.id === ui.model.value);
  if (!model || (config.plan === "spark" && model.paid)) return;
  const turn = { id: crypto.randomUUID(), model: model.id, prompt, answer: "", usage: null };
  setBusy(true);
  ui.prompt.value = "";
  ui.empty.hidden = true;
  addMessage("user", "나", prompt);
  const bubble = addMessage("model", model.label, "연결 중…");
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
  announce("연결과 이전 대화를 확인하는 중…");
  try {
    const reply = await ask({
      config, debug, model: model.id, turns: current.turns, prompt,
      onGenerating: () => announce("답변을 생성하는 중…"),
      onText: (text) => {
        turn.answer = text;
        const stickToBottom = ui.conversation.scrollHeight - ui.conversation.scrollTop -
          ui.conversation.clientHeight < 100;
        bubble.textContent = text;
        if (stickToBottom) ui.conversation.scrollTop = ui.conversation.scrollHeight;
      },
    });
    Object.assign(turn, reply);
    const saved = await remember(turn);
    announce(saved ? "" : "브라우저 저장에 실패했어요. 현재 탭에서만 대화가 유지됩니다.", !saved);
  } catch (error) {
    if (turn.answer) {
      const saved = await remember(turn);
      announce(saved ? "응답이 중단되어 받은 부분만 저장했어요." : "응답이 중단됐고 브라우저 저장에 실패했어요.", true);
    } else {
      if (!ui.prompt.value) ui.prompt.value = prompt;
      announce(errorMessage(error), true);
    }
  } finally {
    setBusy(false);
    render({ preserveModel: true });
  }
}

const fields = ui["settings-form"].elements;
function updateSettingsForm() {
  if (fields.backend.value === "vertex") fields.plan.value = "blaze";
  fields.plan.disabled = fields.backend.value === "vertex";
  fields.debugToken.disabled = !fields.debugEnabled.checked;
  fields.siteKey.required = !loopback || !fields.debugEnabled.checked;
}

function openSettings() {
  if (busy) return;
  for (const name of ["projectId", "appId", "apiKey", "siteKey", "backend", "plan"]) {
    fields[name].value = config[name] ?? "";
  }
  fields.debugEnabled.checked = Boolean(debug.enabled);
  fields.debugToken.value = debug.token ?? "";
  ui["settings-error"].textContent = "";
  updateSettingsForm();
  ui.settings.showModal();
}

function saveSettings(event) {
  event.preventDefault();
  const useDebug = loopback && fields.debugEnabled.checked;
  const updated = {};
  for (const name of ["projectId", "appId", "apiKey", "siteKey", "backend", "plan"]) {
    updated[name] = fields[name].value.trim();
  }
  if (!updated.projectId || !updated.appId || !updated.apiKey || (!updated.siteKey && !useDebug)) {
    ui["settings-error"].textContent = "Firebase 웹 설정과 App Check 설정을 확인해 주세요.";
    return;
  }
  try {
    writeSetting("firebase", updated);
    if (loopback) writeSetting("debug", useDebug ? { enabled: true, token: fields.debugToken.value.trim() } : null, true);
    location.reload();
  } catch {
    ui["settings-error"].textContent = "브라우저에 설정을 저장할 수 없어요.";
  }
}

async function start() {
  for (const model of models) {
    const option = new Option(model.label, model.id);
    if (config.plan === "spark" && model.paid) {
      option.disabled = true;
      option.textContent += " · Blaze 필요";
    }
    ui.model.append(option);
  }
  ui["debug-fields"].hidden = !loopback;
  ui.prompt.maxLength = maxPromptChars;
  ui.model.addEventListener("change", () => {
    try { writeSetting("model", ui.model.value); } catch { /* Selection still applies to the next message. */ }
  });
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
  fields.backend.addEventListener("change", updateSettingsForm);
  fields.debugEnabled.addEventListener("change", updateSettingsForm);
  ui["reset-settings"].addEventListener("click", () => {
    try {
      writeSetting("firebase", null);
      if (loopback) writeSetting("debug", null, true);
      location.reload();
    } catch {
      ui["settings-error"].textContent = "이 브라우저에서 저장된 설정을 지울 수 없어요.";
    }
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
