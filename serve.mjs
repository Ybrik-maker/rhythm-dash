import http from "http"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { fileURLToPath } from "url"
import { SKINS, skinUnlocked } from "./js/skins.js"
import { replayRun } from "./js/physics.js"
import { attachMotion } from "./js/levelgen.js"

const root = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 8734)
const promoCode = process.env.PROMO_CODE || "NOADS"
const dataDir = process.env.DATA_DIR || path.join(root, "..", "rytmus-dash-data")
const dataFile = path.join(dataDir, "accounts.json")
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
}

function emptyDb() {
  return { users: {}, tokens: {} }
}

function readDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"))
    if (!parsed.users || !parsed.tokens) return emptyDb()
    return parsed
  } catch {
    return emptyDb()
  }
}

function writeDb(data) {
  fs.mkdirSync(dataDir, { recursive: true })
  const temp = `${dataFile}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data))
  fs.renameSync(temp, dataFile)
}

let chain = Promise.resolve()
function update(fn) {
  const run = chain.then(() => fn(readDb()))
  chain = run.then(() => {}, () => {})
  return run
}

function send(res, status, payload, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra,
  })
  res.end(JSON.stringify(payload))
}

function isSecure(req) {
  return Boolean(req.socket?.encrypted) || req.headers["x-forwarded-proto"] === "https"
}

function sessionCookie(token, secure) {
  const bits = [
    `rd_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${60 * 60 * 24 * 90}`,
  ]
  if (secure) bits.push("Secure")
  return bits.join("; ")
}

function clearCookie(secure) {
  const bits = ["rd_session=", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"]
  if (secure) bits.push("Secure")
  return bits.join("; ")
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ""
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return ""
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > 2000000) {
        reject(new Error("too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new Error("bad request"))
      }
    })
    req.on("error", reject)
  })
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16)
  if (!/^[\p{L}\p{N} ]{2,16}$/u.test(name)) return ""
  return name
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex")
}

function publicUser(user) {
  const cleared = new Set(user.cleared || [])
  const scores = Object.entries(user.scores || {}).map(([id, score]) => {
    if (score.clearedOn) cleared.add(id)
    return { id, ...score }
  })
  scores.sort((a, b) => (b.best || 0) - (a.best || 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
  return {
    name: user.name,
    skin: user.skin || "slab",
    noAds: Boolean(user.noAds),
    created: (user.created || []).length,
    clears: cleared.size,
    scores,
  }
}

function userFrom(req, db) {
  const header = req.headers.authorization || ""
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : ""
  const token = bearer || readCookie(req, "rd_session")
  const row = token && db.tokens[token]
  if (!row || row.exp < Date.now()) return null
  const user = db.users[row.user]
  if (!user) return null
  return { token, key: row.user, user }
}

function addId(list, id) {
  const clean = String(id || "").slice(0, 80)
  if (!clean || list.includes(clean) || list.length > 500) return
  list.push(clean)
}

function sanitizeLevel(raw) {
  if (!raw || typeof raw !== "object") return null
  const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : [])
  const duration = Number(raw.duration)
  const speed = Number(raw.speed)
  if (!Number.isFinite(duration) || duration < 6 || duration > 12 * 60) return null
  if (!Number.isFinite(speed) || speed < 100 || speed > 2000) return null
  const obstacles = list(raw.obstacles, 8000).map((item) => {
    if (!item || typeof item !== "object") return null
    const { tris, ...rest } = item
    return rest
  }).filter(Boolean)
  return {
    duration,
    finishTime: Number(raw.finishTime) || duration,
    speed,
    dropMul: Number(raw.dropMul) || 1.48,
    airTime: Number(raw.airTime) || 0.45,
    jumpV: Number(raw.jumpV) || 0,
    gravity: Number(raw.gravity) || 0,
    sections: list(raw.sections, 80),
    floors: list(raw.floors, 4000),
    obstacles,
    pads: list(raw.pads, 2000),
    orbs: list(raw.orbs, 4000),
    portals: list(raw.portals, 200),
    flight: list(raw.flight, 80),
    walls: list(raw.walls, 4000),
    checkpoints: list(raw.checkpoints, 4000),
  }
}

function mergeScore(db, user, patch) {
  const id = String(patch.id || "").slice(0, 80)
  if (!id) return
  if (!db.levels) db.levels = {}
  if (patch.level && !db.levels[id]) {
    const clean = sanitizeLevel(patch.level)
    if (clean) db.levels[id] = clean
  }
  if (patch.created !== false && db.levels[id]) addId(user.created, id)
  const row = user.scores[id] || { title: "", songName: "", attempts: 0, best: 0, clearedOn: 0, updatedAt: 0 }
  if (patch.title) row.title = String(patch.title).slice(0, 80)
  if (patch.songName) row.songName = String(patch.songName).slice(0, 80)
  const stored = db.levels[id]
  const replay = patch.replay
  if (stored && replay && Array.isArray(replay.frames) && replay.frames.length) {
    try {
      const level = attachMotion(structuredClone(stored))
      const result = replayRun(level, replay)
      if (result) {
        row.attempts += 1
        const percent = Math.max(0, Math.min(100, Math.round((result.t / level.duration) * 100)))
        if (percent > (row.best || 0)) row.best = percent
        if (result.cleared && !row.clearedOn) {
          row.clearedOn = row.attempts
          row.immortal = result.immortal === true
          addId(user.cleared, id)
        }
      }
    } catch (error) {
      console.error(error)
    }
  }
  row.updatedAt = Date.now()
  user.scores[id] = row
}

function issue(db, key) {
  const token = crypto.randomBytes(24).toString("hex")
  db.tokens[token] = { user: key, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 }
  return token
}

async function handleApi(req, res, url) {
  let body = {}
  if (req.method === "POST") {
    try {
      body = await readBody(req)
    } catch (error) {
      send(res, 400, { error: error.message || "bad request" })
      return
    }
  }

  if (url === "/api/register" && req.method === "POST") {
    const name = cleanName(body.name)
    const password = String(body.password || "")
    if (!name) {
      send(res, 400, { error: "The name needs 2 to 16 characters." })
      return
    }
    if (password.length < 4 || password.length > 64) {
      send(res, 400, { error: "The password needs at least 4 characters." })
      return
    }
    const result = await update((db) => {
      const key = name.toLocaleLowerCase("cs")
      if (db.users[key]) return { error: "That name already has an account.", status: 409 }
      const salt = crypto.randomBytes(16).toString("hex")
      db.users[key] = {
        name,
        salt,
        hash: hashPassword(password, salt),
        skin: "slab",
        created: [],
        cleared: [],
        scores: {},
      }
      const token = issue(db, key)
      writeDb(db)
      return { token, ...publicUser(db.users[key]) }
    })
    if (result.token) send(res, 200, result, { "Set-Cookie": sessionCookie(result.token, isSecure(req)) })
    else send(res, result.status || 400, { error: result.error })
    return
  }

  if (url === "/api/login" && req.method === "POST") {
    const name = cleanName(body.name)
    const password = String(body.password || "")
    const result = await update((db) => {
      const key = name.toLocaleLowerCase("cs")
      const user = name && db.users[key]
      const hash = user ? hashPassword(password, user.salt) : ""
      const valid = user && hash.length === user.hash.length && crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))
      if (!valid) return { error: "Name or password does not match.", status: 401 }
      const token = issue(db, key)
      writeDb(db)
      return { token, ...publicUser(user) }
    })
    if (result.token) send(res, 200, result, { "Set-Cookie": sessionCookie(result.token, isSecure(req)) })
    else send(res, result.status || 401, { error: result.error })
    return
  }

  if (url === "/api/logout" && req.method === "POST") {
    await update((db) => {
      const auth = userFrom(req, db)
      if (auth) delete db.tokens[auth.token]
      writeDb(db)
    })
    send(res, 200, { ok: true }, { "Set-Cookie": clearCookie(isSecure(req)) })
    return
  }

  if (url === "/api/me" && req.method === "GET") {
    const db = readDb()
    const auth = userFrom(req, db)
    if (!auth) {
      send(res, 401, { error: "You are not signed in." })
      return
    }
    send(res, 200, publicUser(auth.user))
    return
  }

  if (url === "/api/progress" && req.method === "POST") {
    const result = await update((db) => {
      const auth = userFrom(req, db)
      if (!auth) return { error: "You are not signed in.", status: 401 }
      const user = auth.user
      for (const id of body.createdIds || []) addId(user.created, id)
      for (const id of body.clearedIds || []) addId(user.cleared, id)
      const levels = Array.isArray(body.levels) ? body.levels : body.id ? [body] : []
      for (const level of levels.slice(0, 40)) mergeScore(db, user, level)
      writeDb(db)
      return publicUser(user)
    })
    send(res, result.status || 200, result.error ? { error: result.error } : result)
    return
  }

  if (url === "/api/promo" && req.method === "POST") {
    if (body.off) {
      const result = await update((db) => {
        const auth = userFrom(req, db)
        if (!auth) return { noAds: false }
        auth.user.noAds = false
        writeDb(db)
        return publicUser(auth.user)
      })
      send(res, 200, result)
      return
    }
    const code = String(body.code || "").trim()
    if (!code || code.toUpperCase() !== promoCode.toUpperCase()) {
      send(res, 403, { error: "That code does not work." })
      return
    }
    const result = await update((db) => {
      const auth = userFrom(req, db)
      if (!auth) return { noAds: true }
      auth.user.noAds = true
      writeDb(db)
      return publicUser(auth.user)
    })
    send(res, 200, result)
    return
  }

  if (url === "/api/skin" && req.method === "POST") {
    const result = await update((db) => {
      const auth = userFrom(req, db)
      if (!auth) return { error: "You are not signed in.", status: 401 }
      const id = String(body.id || "")
      const skin = SKINS.find((item) => item.id === id)
      const view = publicUser(auth.user)
      if (!skin || !skinUnlocked(skin, view)) return { error: "That skin is still locked.", status: 403 }
      auth.user.skin = id
      writeDb(db)
      return publicUser(auth.user)
    })
    send(res, result.status || 200, result.error ? { error: result.error } : result)
    return
  }

  send(res, 404, { error: "not found" })
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0])
  if (url.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      if (!res.headersSent) send(res, 500, { error: "The account is not working right now." })
      console.error(error)
    })
    return
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405)
    res.end("forbidden")
    return
  }
  const relative = url === "/" ? "index.html" : url.replace(/^[/\\]+/, "")
  const hiddenFile = /^(serve\.mjs|package\.json|package-lock\.json)$/i.test(relative) || relative.startsWith("test/") || relative.startsWith("test\\")
  if (hiddenFile) {
    res.writeHead(404)
    res.end("not found")
    return
  }
  const filePath = path.join(root, relative)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  const resolved = path.resolve(filePath)
  const dataResolved = path.resolve(dataDir)
  const insideData = resolved === dataResolved || resolved.startsWith(dataResolved + path.sep)
  if (insideData || (filePath !== path.join(root, "index.html") && !filePath.startsWith(rootWithSep))) {
    res.writeHead(403)
    res.end("forbidden")
    return
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(req.method === "HEAD" ? 200 : 200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    })
    res.end(req.method === "HEAD" ? undefined : data)
  })
})

server.listen(port, "0.0.0.0", () => {
  console.log(`http://127.0.0.1:${port}`)
  console.log(`network: port ${port} on every address of this computer`)
})
