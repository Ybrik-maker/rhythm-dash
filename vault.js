const DB = "rytmus-dash"
const STORE = "levels"

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    const request = fn(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

function plainLevel(level) {
  const copy = {}
  for (const [key, value] of Object.entries(level)) {
    if (typeof value === "function") continue
    if (key === "obstacles") {
      copy.obstacles = value.map((obstacle) => {
        const { tris, ...rest } = obstacle
        return rest
      })
      continue
    }
    copy[key] = value
  }
  return copy
}

export const vault = {
  async save(level, audio, mime, user) {
    const existing = await run("readonly", (store) => store.get(level.id))
    const row = {
      id: level.id,
      user,
      title: level.title,
      songName: level.songName,
      savedAt: Date.now(),
      attempts: existing?.attempts || 0,
      best: existing?.best || 0,
      clearedOn: existing?.clearedOn || 0,
      immortal: existing?.immortal,
      mime: mime || existing?.mime || "audio/mpeg",
      audio: audio || existing?.audio,
      level: plainLevel(level),
    }
    await run("readwrite", (store) => store.put(row))
    return row
  },
  async allMeta() {
    const all = await run("readonly", (store) => store.getAll())
    return (all || [])
      .map(({ audio, level, ...meta }) => meta)
      .sort((a, b) => b.savedAt - a.savedAt)
  },
  async list(user) {
    const all = await this.allMeta()
    return all.filter((row) => row.user === user)
  },
  get(id) {
    return run("readonly", (store) => store.get(id))
  },
  remove(id) {
    return run("readwrite", (store) => store.delete(id))
  },
  async touch(id, patch) {
    const row = await run("readonly", (store) => store.get(id))
    if (!row) return null
    if (patch.attempts > row.attempts) row.attempts = patch.attempts
    if (patch.percent > row.best) row.best = patch.percent
    if (patch.cleared && !row.clearedOn) {
      row.clearedOn = patch.attempts
      row.immortal = Boolean(patch.immortal)
    }
    await run("readwrite", (store) => store.put(row))
    return row
  },
}
