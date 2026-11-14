const prefix = `argon-chat:${new URL(".", import.meta.url).pathname}:`;
const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(`${prefix}conversations`, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("chats", { keyPath: "id" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("chats", mode);
      const request = run(tx.objectStore("chats"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const readChats = async () => {
  const chats = await transaction("readonly", (store) => store.getAll());
  return chats.filter((chat) => !chat.deleted);
};

export const readChat = (id) => transaction("readonly", (store) => store.get(id));

export function mergeTurns(stored, incoming) {
  const turns = new Map(stored.map((turn) => [turn.id, turn]));
  for (const turn of incoming) {
    const existing = turns.get(turn.id);
    if (!existing) {
      turns.set(turn.id, turn);
    } else if ((turn.prompt === null && existing.prompt !== null) ||
               (turn.answer === null && existing.answer !== null)) {
      turns.set(turn.id, {
        ...existing,
        prompt: turn.prompt === null ? null : existing.prompt,
        answer: turn.answer === null ? null : existing.answer,
      });
    }
  }
  return [...turns.values()];
}

export function chatTitle(turns) {
  return turns.find(({ prompt }) => prompt)?.prompt.replace(/\s+/g, " ").slice(0, 48) ?? "새 채팅";
}

export function withoutMessage(chat, turnId, field) {
  const turn = chat.turns.find(({ id }) => id === turnId);
  if (!turn || turn[field] === null) return chat;
  const turns = chat.turns.map((entry) => entry.id === turnId ? { ...entry, [field]: null } : entry);
  return { ...chat, turns, title: field === "prompt" ? chatTitle(turns) : chat.title };
}

export async function saveChat(chat, { saveInstructions = false } = {}) {
  return updateChat(chat, (merged) => merged, saveInstructions);
}

export async function deleteMessage(chat, turnId, field) {
  return updateChat(chat, (merged) => withoutMessage(merged, turnId, field));
}

async function updateChat(chat, change, saveInstructions = false) {
  let merged;
  await transaction("readwrite", (store) => {
    const request = store.get(chat.id);
    request.onsuccess = () => {
      const stored = request.result;
      if (stored?.deleted) return;
      const storedTurns = stored?.turns ?? [];
      const turns = mergeTurns(storedTurns, chat.turns);
      const removedPrompt = storedTurns.some(({ prompt }, i) => prompt && turns[i].prompt === null);
      const title = !stored ? chat.title
        : removedPrompt || !storedTurns.some(({ prompt }) => prompt) ? chatTitle(turns) : stored.title;
      merged = change({
        ...chat,
        title,
        updatedAt: Math.max(stored?.updatedAt ?? 0, chat.updatedAt),
        instructions: saveInstructions ? chat.instructions : stored?.instructions ?? chat.instructions ?? "",
        turns,
      });
      store.put(merged);
    };
    return request;
  });
  if (!merged) throw new Error("chat-deleted");
  return merged;
}

export async function importChats(chats) {
  const counts = { added: 0, updated: 0, skipped: 0 };
  let visibleChats;
  await transaction("readwrite", (store) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const storedChats = new Map(request.result.map((chat) => [chat.id, chat]));
      for (const chat of chats) {
        const stored = storedChats.get(chat.id);
        if (!stored) {
          store.add(chat);
          storedChats.set(chat.id, chat);
          counts.added++;
          continue;
        }
        if (stored.deleted) {
          counts.skipped++;
          continue;
        }
        const turns = mergeTurns(stored.turns, chat.turns);
        const changed = turns.length !== stored.turns.length || stored.turns.some((turn, i) => turn !== turns[i]);
        if (!changed && (stored.instructions != null || !chat.instructions)) {
          counts.skipped++;
          continue;
        }
        const hadPrompt = stored.turns.some(({ prompt }) => prompt);
        const removedPrompt = stored.turns.some(({ prompt }, i) => prompt && turns[i].prompt === null);
        const merged = {
          ...stored,
          title: hadPrompt && !removedPrompt ? stored.title : chatTitle(turns),
          updatedAt: Math.max(stored.updatedAt, chat.updatedAt),
          instructions: stored.instructions ?? chat.instructions,
          turns,
        };
        store.put(merged);
        storedChats.set(chat.id, merged);
        counts.updated++;
      }
      visibleChats = Array.from(storedChats.values()).filter((chat) => !chat.deleted);
    };
    return request;
  });
  return { counts, chats: visibleChats };
}

// Keep a content-free tombstone so another open tab cannot restore a deleted chat.
export const deleteChat = (id) => transaction("readwrite", (store) => store.put({ id, deleted: true }));

export function readSetting(name, session = false) {
  try {
    const store = session ? sessionStorage : localStorage;
    return JSON.parse(store.getItem(prefix + name));
  } catch {
    return null;
  }
}

export function writeSetting(name, value, session = false) {
  const store = session ? sessionStorage : localStorage;
  if (value === null) {
    store.removeItem(prefix + name);
  } else {
    store.setItem(prefix + name, JSON.stringify(value));
  }
}
