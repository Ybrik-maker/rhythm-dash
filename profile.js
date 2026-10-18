import { skinById } from "./skins.js"

const KEY = "rytmus-dash-profile"

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "")
    if (data && typeof data.name === "string") return data
  } catch {
    /* první spuštění */
  }
  return { name: "Player", skin: "slab", names: ["Player"], created: [], cleared: [] }
}

function write(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export const profile = {
  load() {
    const data = read()
    data.skin = skinById(data.skin).id
    if (!Array.isArray(data.names) || !data.names.includes(data.name)) {
      data.names = [...new Set([data.name, ...(data.names || [])])].slice(0, 8)
      write(data)
    }
    return data
  },
  name() {
    return this.load().name
  },
  skin() {
    return skinById(this.load().skin)
  },
  names() {
    return this.load().names
  },
  setName(name) {
    const clean = name.trim().slice(0, 16) || "Player"
    const data = this.load()
    data.name = clean
    data.names = [clean, ...data.names.filter((item) => item !== clean)].slice(0, 8)
    write(data)
    return data
  },
  setSkin(id) {
    const data = this.load()
    data.skin = skinById(id).id
    write(data)
    return this.skin()
  },
  progress() {
    const data = this.load()
    const created = Array.isArray(data.created) ? data.created : []
    const cleared = Array.isArray(data.cleared) ? data.cleared : []
    return { created: created.length, clears: cleared.length, createdIds: created, clearedIds: cleared }
  },
  noteCreated(id) {
    if (!id) return this.progress()
    const data = this.load()
    data.created = Array.isArray(data.created) ? data.created : []
    if (!data.created.includes(id)) data.created.push(id)
    write(data)
    return this.progress()
  },
  noteCleared(id) {
    if (!id) return this.progress()
    const data = this.load()
    data.cleared = Array.isArray(data.cleared) ? data.cleared : []
    if (!data.cleared.includes(id)) data.cleared.push(id)
    write(data)
    return this.progress()
  },
}
