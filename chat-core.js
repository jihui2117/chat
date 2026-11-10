export const models = [
  { id: "gemini-4-argon", label: "Gemini 4 Argon", paid: true },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", paid: false },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", paid: true },
];

export const defaultModel = "gemini-3.8-flash";
export const maxPromptChars = 40_000;
const maxTurns = 20;
const historyBudget = 10_000;
const modelRates = {
  "gemini-4-argon": {
    before: "2026-12-01",
    introductory: { input: 2, cached: 0.10, output: 10 },
    standard: { input: 4, cached: 0.20, output: 20 },
  },
  "gemini-3.8-flash": {
    before: "2027-01-01",
    introductory: { input: 0.75, cached: 0.075, output: 3.75 },
    standard: { input: 1.50, cached: 0.15, output: 7.50 },
  },
  "gemini-3.1-pro-preview": {
    standard: { input: 2, cached: 0.20, output: 12 },
    longContext: { input: 4, cached: 0.40, output: 18 },
  },
};

function tokenCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function measureUsage(metadata, model, plan, date = new Date().toISOString().slice(0, 10)) {
  const input = tokenCount(metadata?.promptTokenCount);
  // A prompt can complete without a visible candidate, for example after safety filtering.
  const output = tokenCount(metadata?.candidatesTokenCount) ?? (input === null ? null : 0);
  const thinking = tokenCount(metadata?.thoughtsTokenCount) ?? 0;
  const table = modelRates[model];
  let usd = null;
  if (table && input !== null && output !== null) {
    let rates = table.standard;
    if (table.before && date < table.before) rates = table.introductory;
    if (table.longContext && input > 200_000) rates = table.longContext;
    const cached = Math.min(input, tokenCount(metadata.cachedContentTokenCount) ?? 0);
    usd = plan === "spark" ? 0 : (
      (input - cached) * rates.input + cached * rates.cached + (output + thinking) * rates.output
    ) / 1_000_000;
  }
  return { input, output, thinking, usd };
}

export function totals(turns) {
  const result = { input: 0, output: 0, thinking: 0, usd: 0, incomplete: false };
  for (const { usage } of turns) {
    result.input += usage?.input ?? 0;
    result.output += usage?.output ?? 0;
    result.thinking += usage?.thinking ?? 0;
    result.usd += usage?.usd ?? 0;
    result.incomplete ||= usage?.usd == null;
  }
  return result;
}

export function content(role, text) {
  return { role, parts: [{ text }] };
}

export async function fitHistory(turns, current, countTokens) {
  const recent = turns.filter((turn) => turn.answer).slice(-maxTurns);
  if (!recent.length) return [current];
  const base = await countTokens([current]);
  let low = 0;
  let high = recent.length;

  // Each request includes a suffix of complete turns and the new message.
  // Find the largest suffix that fits while always retaining the new message.
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    const candidate = [...historyContents(recent.slice(-count)), current];
    if ((await countTokens(candidate)) - base <= historyBudget) {
      low = count;
    } else {
      high = count - 1;
    }
  }
  return low ? [...historyContents(recent.slice(-low)), current] : [current];
}

function historyContents(turns) {
  return turns.flatMap(({ prompt, answer }) => [content("user", prompt), content("model", answer)]);
}
