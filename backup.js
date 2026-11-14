const format = "argon-chat-backup";
const version = 1;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireValid(condition) {
  if (!condition) throw new Error("invalid-backup");
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function sanitizeUsage(usage) {
  if (usage == null) return null;
  requireValid(record(usage));
  const result = {};
  for (const key of ["input", "output", "thinking", "usd"]) {
    const value = usage[key];
    if (value == null) continue;
    requireValid(Number.isFinite(value) && value >= 0);
    result[key] = value;
  }
  return result;
}

function sanitizeTurn(turn) {
  requireValid(record(turn) && typeof turn.id === "string" && turn.id &&
    typeof turn.model === "string" && turn.model && typeof turn.prompt === "string" &&
    typeof turn.answer === "string");
  return { id: turn.id, model: turn.model, prompt: turn.prompt, answer: turn.answer, usage: sanitizeUsage(turn.usage) };
}

function sanitizeChat(chat) {
  requireValid(record(chat) && !chat.deleted && typeof chat.id === "string" && chat.id &&
    typeof chat.title === "string" && timestamp(chat.updatedAt) && Array.isArray(chat.turns) &&
    (chat.instructions == null || typeof chat.instructions === "string"));
  const turns = chat.turns.map(sanitizeTurn);
  requireValid(new Set(turns.map(({ id }) => id)).size === turns.length);
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, instructions: chat.instructions ?? "", turns };
}

export function makeBackup(chats, commonInstructions) {
  return JSON.stringify({ format, version, commonInstructions, chats: chats.map(sanitizeChat) });
}

export function readBackup(text) {
  const backup = JSON.parse(text);
  requireValid(record(backup) && backup.format === format && backup.version === version &&
    typeof backup.commonInstructions === "string" && Array.isArray(backup.chats));
  const chats = backup.chats.map(sanitizeChat);
  requireValid(new Set(chats.map(({ id }) => id)).size === chats.length);
  return { chats, commonInstructions: backup.commonInstructions };
}
