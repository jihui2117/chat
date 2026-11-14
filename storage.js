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

export async function saveChat(chat, { saveInstructions = false } = {}) {
  let merged;
  await transaction("readwrite", (store) => {
    const request = store.get(chat.id);
    request.onsuccess = () => {
      const stored = request.result;
      if (stored?.deleted) return;
      const storedTurns = stored?.turns ?? [];
      const existingIds = new Set(storedTurns.map((turn) => turn.id));
      merged = {
        ...chat,
        title: storedTurns.length ? stored.title : chat.title,
        instructions: saveInstructions ? chat.instructions : stored?.instructions ?? chat.instructions ?? "",
        turns: [...storedTurns, ...chat.turns.filter((turn) => !existingIds.has(turn.id))],
      };
      store.put(merged);
    };
    return request;
  });
  if (!merged) throw new Error("chat-deleted");
  return merged;
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
