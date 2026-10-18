import { analyzeBuffer, analyzeSamples, bindSections } from "./analyze.js"
import { encodeWav, makeDemo } from "./demo.js"
import { mountGame } from "./game.js"
import { attachMotion, generateLevelLive } from "./levelgen.js"
import { account } from "./account.js"
import { refreshAds } from "./ads.js"
import { profile } from "./profile.js"
import { SKINS, drawSkin, skinById, skinUnlocked } from "./skins.js"
import { vault } from "./vault.js"

const auth = document.querySelector("#auth")
const menu = document.querySelector("#menu")
const playhub = document.querySelector("#playhub")
const skins = document.querySelector("#skins")
const scores = document.querySelector("#scores")
const accountScreen = document.querySelector("#account")
const loading = document.querySelector("#loading")
const brief = document.querySelector("#brief")
const pause = document.querySelector("#pause")
const win = document.querySelector("#win")
const screens = [auth, menu, playhub, skins, scores, accountScreen, loading, brief, pause, win]
const GUEST = "rytmus-dash-guest"
const audio = document.querySelector("#music")
const canvas = document.querySelector("#view")
const fileInput = document.querySelector("#file")
const toast = document.querySelector("#toast")

const state = {
  level: null,
  features: null,
  url: null,
  busy: false,
  brush: "drop",
  paint: null,
  session: null,
}

const game = mountGame(canvas, {
  onWin(stats) {
    document.querySelector("#winTitle").textContent = stats.songName || stats.title
    document.querySelector("#winCopy").textContent = scoreText({
      clearedOn: stats.attempts,
      immortal: stats.immortal,
    })
    show(win)
  },
  onPause(paused) {
    if (paused) show(pause)
    else show(null)
  },
  onRun(stats) {
    if (stats.cleared) profile.noteCleared(stats.id)
    vault.touch(stats.id, stats).then((row) => {
      if (row && state.level?.id === row.id) state.record = row
      const level = state.level
      pushProgress({
        id: stats.id,
        title: level?.songName || level?.title,
        songName: level?.songName,
        attempts: stats.attempts,
        best: stats.percent,
        clearedOn: stats.cleared ? stats.attempts : 0,
        replay: stats.replay || null,
        level: stats.replay ? scoreLevel(level) : null,
        created: false,
      })
    }).catch(() => {})
  },
})

function show(screen) {
  for (const node of screens) node.classList.add("hidden")
  screen?.classList.remove("hidden")
  if (screen && screen !== pause) document.querySelector("#pauseBtn").classList.add("hidden")
  document.body.classList.toggle("playing", !screen)
  document.body.classList.toggle("paused", screen === pause)
  if (screen === menu) paintHub()
  if (screen === playhub) renderSaved()
  if (screen === skins) paintSkins()
  if (screen === scores) renderScores()
  if (screen === accountScreen) {
    applyAds()
    paintAccount()
  }
  refreshAds()
}

function paintHub() {
  const who = document.querySelector("#hubWho")
  who.textContent = state.session ? state.session.name : `Guest · ${profile.name()}`
}

const ADS_KEY = "rytmus-dash-noads"

function applyAds() {
  if (state.session?.noAds) localStorage.setItem(ADS_KEY, "1")
  const hidden = localStorage.getItem(ADS_KEY) === "1" || Boolean(state.session?.noAds)
  document.body.classList.toggle("no-ads", hidden)
  const form = document.querySelector("#promoForm")
  const note = document.querySelector("#promoState")
  const off = document.querySelector("#promoOff")
  if (!form || !note || !off) return
  form.classList.toggle("hidden", hidden)
  off.classList.toggle("hidden", !hidden)
  note.textContent = hidden ? "Promo code applied. Ads are hidden." : ""
  refreshAds()
}

function paintAccount() {
  const hello = document.querySelector("#accountHello")
  const copy = document.querySelector("#accountCopy")
  const guestWrap = document.querySelector("#guestNameWrap")
  const logout = document.querySelector("#accountLogout")
  const enter = document.querySelector("#accountEnter")
  if (state.session) {
    hello.textContent = state.session.name
    copy.textContent = "You are signed in. Scores and skins live on the server, so the same account works when the game is on the web."
    guestWrap.classList.add("hidden")
    logout.classList.remove("hidden")
    enter.classList.add("hidden")
    return
  }
  hello.textContent = "Guest"
  copy.textContent = "Sign in to store scores on the server. You will see them on the web and on another device."
  guestWrap.classList.remove("hidden")
  logout.classList.add("hidden")
  enter.classList.remove("hidden")
}

function showPauseButton() {
  document.querySelector("#pauseBtn").classList.remove("hidden")
}

let toastTimer = 0
function showToast(message) {
  toast.textContent = message
  toast.classList.add("on")
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove("on"), 5200)
}

function setLoad(progress, message) {
  document.querySelector("#barFill").style.width = `${Math.round(progress * 100)}%`
  document.querySelector("#loadMsg").textContent = message
  const log = document.querySelector("#loadLog")
  const last = log.lastElementChild
  if (last && last.textContent === message) return
  const item = document.createElement("li")
  item.textContent = message
  log.appendChild(item)
}

const SECTION_NAME = {
  intro: "intro",
  rise: "build",
  drop: "drop",
  break: "break",
  outro: "outro",
}

const SECTION_COLOR = {
  intro: "#4c6e8a",
  rise: "#ee964b",
  drop: "#ff4d6d",
  break: "#7c6bff",
  outro: "#3dcc9a",
}

function drawWave(level) {
  const wave = document.querySelector("#wave")
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = wave.clientWidth || 460
  const height = 72
  wave.width = Math.floor(width * dpr)
  wave.height = Math.floor(height * dpr)
  const ctx = wave.getContext("2d")
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const sections = state.features?.sections || level.sections
  const bars = level.waveform || []
  const slot = width / Math.max(1, bars.length)
  bars.forEach((pair, index) => {
    const time = (index / bars.length) * level.duration
    const section = sections.find((item) => time >= item.start && time < item.end)
    ctx.fillStyle = SECTION_COLOR[section?.type] || "#9ad"
    const amp = Math.max(2, (pair[1] - pair[0]) * 30)
    ctx.fillRect(index * slot, height / 2 - amp / 2, Math.max(1, slot - 1), amp)
  })
  if (state.paint && level.duration) {
    const a = (Math.min(state.paint.start, state.paint.end) / level.duration) * width
    const b = (Math.max(state.paint.start, state.paint.end) / level.duration) * width
    ctx.fillStyle = "rgba(255,255,255,0.38)"
    ctx.fillRect(a, 0, Math.max(2, b - a), height)
  }
}

function showBrief(level) {
  const trackName = level.songName || level.title
  document.querySelector("#levelTitle").textContent = trackName
  paintFacts(state.record)

  const timeline = document.querySelector("#timeline")
  timeline.replaceChildren()
  for (const section of state.features?.sections || level.sections) {
    const chunk = document.createElement("div")
    chunk.className = "chunk"
    chunk.style.flex = String(Math.max(0.2, section.end - section.start))
    chunk.style.background = SECTION_COLOR[section.type] || "#888"
    chunk.title = SECTION_NAME[section.type] || section.type
    const label = document.createElement("span")
    label.textContent = SECTION_NAME[section.type] || section.type
    chunk.appendChild(label)
    timeline.appendChild(chunk)
  }

  drawWave(level)
  game.preview(level)
  show(brief)
  rememberLevel()
}

function immortalLabel(row) {
  if (!row?.clearedOn) return "—"
  if (row.immortal === true) return "on"
  if (row.immortal === false) return "off"
  return "—"
}

function paintFacts(row) {
  const attempts = document.querySelector("#statAttempts")
  const immortal = document.querySelector("#statImmortal")
  if (!attempts || !immortal) return
  attempts.textContent = row?.clearedOn ? String(row.clearedOn) : "—"
  immortal.textContent = immortalLabel(row)
}

function showRecord(row) {
  paintFacts(row)
  const node = document.querySelector("#record")
  if (node) node.textContent = ""
}

function scoreLevel(level) {
  if (!level?.id && !level?.duration) return null
  const copy = (list) => (Array.isArray(list) ? list : [])
  return {
    duration: level.duration,
    finishTime: level.finishTime,
    speed: level.speed,
    dropMul: level.dropMul,
    airTime: level.airTime,
    jumpV: level.jumpV,
    gravity: level.gravity,
    sections: copy(level.sections),
    floors: copy(level.floors),
    obstacles: copy(level.obstacles).map(({ tris, ...rest }) => rest),
    pads: copy(level.pads),
    orbs: copy(level.orbs),
    portals: copy(level.portals),
    flight: copy(level.flight),
    walls: copy(level.walls),
    checkpoints: copy(level.checkpoints),
  }
}

async function rememberLevel() {
  if (!state.level?.id || !state.audioBuffer) return null
  try {
    state.record = await vault.save(state.level, state.audioBuffer, state.mime, profile.name())
    profile.noteCreated(state.level.id)
    showRecord(state.record)
    pushProgress({
      id: state.level.id,
      title: state.level.songName || state.level.title,
      songName: state.level.songName,
      attempts: state.record.attempts,
      best: state.record.best,
      clearedOn: state.record.clearedOn,
      immortal: state.record.immortal === true,
      level: scoreLevel(state.level),
      created: true,
    })
    return state.record
  } catch {
    showToast("The level could not be saved.")
    return null
  }
}

function progressStats() {
  const local = profile.progress()
  if (!state.session) return { created: local.created, clears: local.clears }
  return {
    created: Math.max(local.created, state.session.created || 0),
    clears: Math.max(local.clears, state.session.clears || 0),
  }
}

let seenUnlocks = null

function noteUnlocks(stats) {
  const open = SKINS.filter((skin) => skinUnlocked(skin, stats))
  if (seenUnlocks) {
    const fresh = open.filter((skin) => !seenUnlocks.has(skin.id))
    if (fresh.length) showToast(`Unlocked: ${fresh.map((skin) => skin.name).join(", ")}`)
  }
  seenUnlocks = new Set(open.map((skin) => skin.id))
}

function paintSkins() {
  const stats = progressStats()
  noteUnlocks(stats)
  if (!skinUnlocked(profile.skin(), stats)) game.setSkin(profile.setSkin("slab"))
  document.querySelector("#skinProgress").textContent = `Cleared levels: ${stats.clears} · created: ${stats.created}`
  const row = document.querySelector("#skinRow")
  const current = profile.skin().id
  row.replaceChildren()
  for (const skin of SKINS) {
    const open = skinUnlocked(skin, stats)
    const button = document.createElement("button")
    button.type = "button"
    button.className = `skin${skin.id === current ? " on" : ""}${open ? "" : " locked"}`
    button.title = open ? skin.name : `${skin.name} — ${skin.hint}`
    const caption = document.createElement("span")
    caption.textContent = open ? skin.name : skin.hint
    const preview = document.createElement("canvas")
    preview.width = 64
    preview.height = 64
    const pen = preview.getContext("2d")
    pen.translate(32, 32)
    pen.scale(1.35, 1.35)
    drawSkin(pen, skin, "cube")
    button.append(preview, caption)
    button.addEventListener("click", () => selectSkin(skin))
    row.append(button)
  }
}

async function selectSkin(skin) {
  if (!skinUnlocked(skin, progressStats())) {
    showToast(skin.hint)
    return
  }
  game.setSkin(profile.setSkin(skin.id))
  paintSkins()
  if (!account.token()) return
  try {
    state.session = await account.setSkin(skin.id)
  } catch (error) {
    showToast(error.message)
  }
}

async function pushProgress(level) {
  if (!account.token()) {
    paintSkins()
    return
  }
  const local = profile.progress()
  try {
    state.session = await account.push({
      createdIds: local.createdIds,
      clearedIds: local.clearedIds,
      levels: level ? [level] : [],
    })
    paintSkins()
    if (!playhub.classList.contains("hidden")) renderSaved()
    if (!scores.classList.contains("hidden")) renderScores()
  } catch {
    paintSkins()
  }
}

function scoreText(row) {
  const attempts = row?.clearedOn ? String(row.clearedOn) : "—"
  return `Attempts to complete: ${attempts} · Immortal mode: ${immortalLabel(row)}`
}

function mergedScore(row, remote) {
  return {
    ...row,
    attempts: Math.max(row.attempts || 0, remote?.attempts || 0),
    best: Math.max(row.best || 0, remote?.best || 0),
    clearedOn: row.clearedOn || remote?.clearedOn || 0,
    immortal: row.clearedOn ? row.immortal : remote?.immortal,
  }
}

function renderScores() {
  const list = document.querySelector("#cloudScores")
  list.replaceChildren()
  const remote = state.session?.scores || []
  if (!state.session) {
    const empty = document.createElement("li")
    empty.textContent = "Sign in. Scores are stored on the server and show up on the web."
    list.append(empty)
    return
  }
  if (!remote.length) {
    const empty = document.createElement("li")
    empty.textContent = "No attempts yet. Clear a level and the number lands here."
    list.append(empty)
    return
  }
  for (const row of remote) {
    const item = document.createElement("li")
    const block = document.createElement("div")
    const title = document.createElement("strong")
    title.textContent = row.songName || row.title || "Level"
    const meta = document.createElement("span")
    meta.textContent = scoreText(row)
    block.append(title, meta)
    item.append(block)
    list.append(item)
  }
}

async function renderSaved() {
  const list = document.querySelector("#saved")
  if (!list) return
  let rows = []
  try {
    rows = state.session ? await vault.allMeta() : await vault.list(profile.name())
  } catch {
    rows = []
  }
  const remote = new Map((state.session?.scores || []).map((row) => [row.id, row]))
  list.replaceChildren()
  if (!rows.length) {
    const empty = document.createElement("li")
    empty.textContent = "Nothing here yet. A song is saved once it becomes a level."
    list.appendChild(empty)
    return
  }
  for (const row of rows) {
    const view = mergedScore(row, remote.get(row.id))
    const item = document.createElement("li")
    const open = document.createElement("button")
    open.type = "button"
    open.className = "play-save"
    const title = document.createElement("strong")
    title.textContent = view.songName || view.title
    const meta = document.createElement("span")
    meta.textContent = scoreText(view)
    open.append(title, meta)
    open.addEventListener("click", () => openSaved(row.id))
    const drop = document.createElement("button")
    drop.type = "button"
    drop.className = "drop-save"
    drop.textContent = "Delete"
    drop.addEventListener("click", async () => {
      await vault.remove(row.id)
      renderSaved()
    })
    item.append(open, drop)
    list.appendChild(item)
  }
}

async function openSaved(id) {
  const row = await vault.get(id)
  if (!row?.level || !row.audio) {
    showToast("The saved level did not load.")
    return
  }
  const bytes = row.audio instanceof Blob ? await row.audio.arrayBuffer() : row.audio
  state.features = null
  state.audioBuffer = bytes
  state.mime = row.mime || "audio/mpeg"
  state.record = row
  state.level = attachMotion(row.level)
  attachAudio(bytes, state.mime)
  showBrief(state.level)
  showRecord(row)
}

function cleanName(name) {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Song"
}

function mimeFrom(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".wav")) return "audio/wav"
  if (lower.endsWith(".ogg")) return "audio/ogg"
  if (lower.endsWith(".m4a")) return "audio/mp4"
  if (lower.endsWith(".flac")) return "audio/flac"
  return "audio/mpeg"
}

async function decodeAudio(arrayBuffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext
  const context = new Ctx()
  try {
    return await context.decodeAudioData(arrayBuffer.slice(0))
  } catch {
    throw new Error("This browser cannot read that format. Try mp3, wav, or ogg.")
  } finally {
    await context.close()
  }
}

function attachAudio(arrayBuffer, mime) {
  if (state.url) URL.revokeObjectURL(state.url)
  const blob = new Blob([arrayBuffer], { type: mime })
  state.url = URL.createObjectURL(blob)
  audio.src = state.url
  audio.load()
}

async function buildFromSamples(samples, sampleRate, name, wavBuffer) {
  const features = await analyzeSamples(samples, sampleRate, setLoad)
  state.features = features
  const level = await generateLevelLive(features, name, setLoad)
  state.level = level
  state.audioBuffer = wavBuffer
  state.mime = "audio/wav"
  state.record = null
  attachAudio(wavBuffer, "audio/wav")
  showBrief(level)
}

async function buildFromFile(arrayBuffer, name) {
  setLoad(0.04, "Loading audio…")
  const decoded = await decodeAudio(arrayBuffer)
  const features = await analyzeBuffer(decoded, setLoad)
  state.features = features
  const level = await generateLevelLive(features, cleanName(name), setLoad)
  state.level = level
  state.audioBuffer = arrayBuffer
  state.mime = mimeFrom(name)
  state.record = null
  attachAudio(arrayBuffer, state.mime)
  showBrief(level)
}

async function guard(work) {
  if (state.busy) return
  state.busy = true
  audio.pause()
  document.querySelector("#loadLog").replaceChildren()
  show(loading)
  try {
    await work()
  } catch (error) {
    console.error(error)
    game.attract()
    show(playhub)
    showToast(error.message || "The song could not be read.")
  } finally {
    state.busy = false
  }
}

const AUDIO_NAME = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|webm|mp4|aif|aiff)$/i

function looksLikeAudio(file) {
  const type = file.type || ""
  if (type.startsWith("audio/")) return true
  if (type === "video/mp4" || type === "video/webm" || type === "application/ogg") return true
  if (AUDIO_NAME.test(file.name)) return true
  if (!type || type === "application/octet-stream") return AUDIO_NAME.test(file.name) || type === ""
  return false
}

function takeFile(file) {
  if (!file) return
  if (!looksLikeAudio(file)) {
    showToast("I need an audio file, such as mp3 or wav. Drop it here, or click it.")
    return
  }
  if (file.size > 40 * 1024 * 1024) {
    showToast("The file is larger than 40 MB. Pick a shorter song.")
    return
  }
  guard(async () => {
    const buffer = await file.arrayBuffer()
    await buildFromFile(buffer, file.name || "Song")
  })
}

const dropzone = document.querySelector("#dropzone")
fileInput.addEventListener("click", (event) => event.stopPropagation())
dropzone.addEventListener("click", () => fileInput.click())
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    fileInput.click()
  }
})

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0]
  fileInput.value = ""
  takeFile(file)
})

document.querySelector("#demo").addEventListener("click", () => {
  guard(async () => {
    setLoad(0.02, "Building the demo beat…")
    await new Promise((resolve) => setTimeout(resolve, 20))
    const demo = makeDemo()
    const wav = encodeWav(demo.data, demo.sampleRate)
    await buildFromSamples(demo.data, demo.sampleRate, demo.name, wav)
  })
})

document.querySelector("#play").addEventListener("click", async () => {
  if (!state.level) return
  show(null)
  try {
    await game.play(state.level, audio, {
      immortal: document.querySelector("#immortal").checked,
      skin: profile.skin(),
    })
    showPauseButton()
  } catch {
    show(brief)
    showToast("The browser blocked the sound. Press Play again.")
  }
})

document.querySelector("#pauseBtn").addEventListener("pointerdown", (event) => {
  event.preventDefault()
  event.stopPropagation()
  game.pauseToggle()
})

document.querySelector("#back").addEventListener("click", () => {
  audio.pause()
  game.attract()
  show(playhub)
})

document.querySelector("#resume").addEventListener("click", () => game.pauseToggle())
document.querySelector("#restartPause").addEventListener("click", async () => {
  show(null)
  showPauseButton()
  await game.restart()
})
document.querySelector("#menuPause").addEventListener("click", () => {
  audio.pause()
  game.attract()
  show(menu)
})
document.querySelector("#again").addEventListener("click", async () => {
  show(null)
  showPauseButton()
  await game.restart()
})
document.querySelector("#menuWin").addEventListener("click", () => {
  audio.pause()
  game.attract()
  show(menu)
})

function dragPayload(event) {
  return Array.from(event.dataTransfer?.types || [])
}

function dragIsUseful(event) {
  const types = dragPayload(event)
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain")
}

window.addEventListener(
  "dragenter",
  (event) => {
    if (!dragIsUseful(event)) return
    event.preventDefault()
    document.body.classList.add("dragging")
  },
  true,
)
window.addEventListener(
  "dragover",
  (event) => {
    if (!dragIsUseful(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    document.body.classList.add("dragging")
  },
  true,
)
window.addEventListener(
  "dragleave",
  (event) => {
    if (event.relatedTarget) return
    document.body.classList.remove("dragging")
  },
  true,
)
window.addEventListener(
  "drop",
  (event) => {
    event.preventDefault()
    document.body.classList.remove("dragging")
    const files = Array.from(event.dataTransfer?.files || [])
    const audioFile = files.find(looksLikeAudio) || (files.length === 1 ? files[0] : null)
    if (audioFile) {
      takeFile(audioFile)
      return
    }
    if (files.length) showToast("I need an audio file, such as mp3 or wav.")
    else showToast("Drop the audio file. A link will not load.")
  },
  true,
)

window.addEventListener("resize", () => {
  if (!brief.classList.contains("hidden") && state.level) drawWave(state.level)
})

function timeFromWave(event) {
  const wave = document.querySelector("#wave")
  const rect = wave.getBoundingClientRect()
  const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left))
  return (x / Math.max(1, rect.width)) * (state.features?.duration || 1)
}

function paintSections(sections, start, end, type, duration) {
  const a = Math.max(0, Math.min(start, end))
  const b = Math.min(duration, Math.max(start, end))
  if (b - a < 0.2) return sections
  const next = []
  for (const section of sections) {
    if (section.end <= a + 0.02 || section.start >= b - 0.02) {
      next.push({ ...section })
      continue
    }
    if (section.start < a - 0.02) next.push({ ...section, end: a })
    if (section.end > b + 0.02) next.push({ ...section, start: b })
  }
  next.push({ type, start: a, end: b })
  next.sort((left, right) => left.start - right.start)
  return next
}

function refreshTimeline() {
  if (!state.level) return
  const timeline = document.querySelector("#timeline")
  timeline.replaceChildren()
  for (const section of state.features?.sections || state.level.sections) {
    const chunk = document.createElement("div")
    chunk.className = "chunk"
    chunk.style.flex = String(Math.max(0.2, section.end - section.start))
    chunk.style.background = SECTION_COLOR[section.type] || "#888"
    const label = document.createElement("span")
    label.textContent = SECTION_NAME[section.type] || section.type
    chunk.appendChild(label)
    timeline.appendChild(chunk)
  }
  drawWave(state.level)
}

const wave = document.querySelector("#wave")
wave.addEventListener("pointerdown", (event) => {
  if (!state.features || brief.classList.contains("hidden")) return
  wave.setPointerCapture(event.pointerId)
  const time = timeFromWave(event)
  state.paint = { start: time, end: time }
  drawWave(state.level)
})
wave.addEventListener("pointermove", (event) => {
  if (!state.paint) return
  state.paint.end = timeFromWave(event)
  drawWave(state.level)
})
function finishPaint() {
  if (!state.paint || !state.features) return
  const { start, end } = state.paint
  state.paint = null
  bindSections(state.features, paintSections(state.features.sections, start, end, state.brush, state.features.duration))
  refreshTimeline()
}
wave.addEventListener("pointerup", finishPaint)
wave.addEventListener("pointercancel", finishPaint)

for (const button of document.querySelectorAll("#brushes .brush")) {
  button.addEventListener("click", () => {
    state.brush = button.dataset.brush
    for (const item of document.querySelectorAll("#brushes .brush")) item.classList.toggle("on", item === button)
  })
}

document.querySelector("#saveLevel").addEventListener("click", () => {
  rememberLevel().then((row) => {
    if (row) showToast("Level saved for this player.")
  })
})

document.querySelector("#rebuild").addEventListener("click", () => {
  if (!state.features || !state.level) {
    showToast("This saved level is already built. Only a freshly loaded song can be rebuilt.")
    return
  }
  const name = state.level.songName
  guard(async () => {
    const level = await generateLevelLive(state.features, name, setLoad)
    state.level = level
    showBrief(level)
  })
})

function holdLandscape() {
  try {
    if (window.VegaNative && window.VegaNative.setLandscape) window.VegaNative.setLandscape(true)
  } catch {}
  const turn = document.querySelector("#turn")
  const sync = () => {
    if (!turn) return
    turn.classList.toggle("hidden", window.innerWidth >= window.innerHeight)
  }
  window.addEventListener("resize", sync)
  window.addEventListener("orientationchange", sync)
  sync()
}

holdLandscape()

const nameInput = document.querySelector("#playerName")
nameInput.value = profile.name()
nameInput.addEventListener("change", () => {
  profile.setName(nameInput.value)
  nameInput.value = profile.name()
  paintHub()
})

let authMode = "login"

function paintAuth() {
  const register = authMode === "register"
  document.querySelector("#authKicker").textContent = register ? "NEW ACCOUNT" : "SIGN IN"
  document.querySelector("#authTitle").textContent = register ? "Create an account" : "Welcome back"
  document.querySelector("#accountSubmit span").textContent = register ? "Create account" : "Sign in"
  document.querySelector("#authSwitch span").textContent = register ? "I have an account" : "I need an account"
  document.querySelector("#accountPass").autocomplete = register ? "new-password" : "current-password"
}

async function applySession(session) {
  state.session = session
  if (!session) {
    paintHub()
    applyAds()
    return
  }
  profile.setName(session.name)
  nameInput.value = session.name
  const stats = { created: session.created || 0, clears: session.clears || 0 }
  if (session.skin && skinUnlocked(skinById(session.skin), stats)) game.setSkin(profile.setSkin(session.skin))
  try {
    const rows = await vault.allMeta()
    state.session = await account.push({
      createdIds: profile.progress().createdIds,
      clearedIds: profile.progress().clearedIds,
      levels: rows.map((row) => ({
        id: row.id,
        title: row.songName || row.title,
        songName: row.songName,
        attempts: row.attempts,
        best: row.best,
        clearedOn: row.clearedOn,
        ...(row.immortal === true || row.immortal === false ? { immortal: row.immortal } : {}),
        created: true,
      })),
    })
  } catch {
    /* přihlášení platí, čísla se doplní při dalším uložení */
  }
  paintHub()
  applyAds()
}

async function signIn(kind) {
  const name = document.querySelector("#accountName").value
  const password = document.querySelector("#accountPass").value
  try {
    const session = kind === "register" ? await account.register(name, password) : await account.login(name, password)
    document.querySelector("#accountPass").value = ""
    sessionStorage.removeItem(GUEST)
    await applySession(session)
    show(menu)
    showToast(kind === "register" ? "Account created." : "Signed in.")
  } catch (error) {
    showToast(error.message)
  }
}

document.querySelector("#accountForm").addEventListener("submit", (event) => {
  event.preventDefault()
  signIn(authMode)
})
document.querySelector("#authSwitch").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login"
  paintAuth()
})
document.querySelector("#guestPlay").addEventListener("click", () => {
  sessionStorage.setItem(GUEST, "1")
  state.session = null
  show(menu)
})
document.querySelector("#goPlay").addEventListener("click", () => show(playhub))
document.querySelector("#goSkins").addEventListener("click", () => show(skins))
document.querySelector("#goScores").addEventListener("click", () => show(scores))
document.querySelector("#goAccount").addEventListener("click", () => show(accountScreen))
for (const id of ["#backHub", "#backSkins", "#backScores", "#backAccount"]) {
  document.querySelector(id).addEventListener("click", () => show(menu))
}
document.querySelector("#accountEnter").addEventListener("click", () => show(auth))
document.querySelector("#promoForm").addEventListener("submit", async (event) => {
  event.preventDefault()
  const input = document.querySelector("#promoCode")
  try {
    const result = await account.promo(input.value)
    localStorage.setItem(ADS_KEY, "1")
    if (result?.name) state.session = result
    input.value = ""
    applyAds()
    showToast("Ads are hidden.")
  } catch (error) {
    showToast(error.message)
  }
})
document.querySelector("#promoOff").addEventListener("click", async () => {
  try {
    if (state.session || account.token()) {
      const result = await account.promoOff()
      if (result?.name) state.session = result
      else if (state.session) state.session.noAds = false
    }
    localStorage.removeItem(ADS_KEY)
    applyAds()
    showToast("Ads are back.")
  } catch (error) {
    showToast(error.message)
  }
})
document.querySelector("#accountLogout").addEventListener("click", async () => {
  await account.logout()
  sessionStorage.removeItem(GUEST)
  await applySession(null)
  show(auth)
})

async function mountBackdrop() {
  try {
    const demo = makeDemo()
    const quiet = () => {}
    const features = await analyzeSamples(demo.data, demo.sampleRate, quiet, demo.duration)
    const level = await generateLevelLive(features, demo.name, quiet)
    game.setBackdrop(level)
  } catch (error) {
    console.error(error)
  }
}

async function backfillProgress() {
  try {
    const rows = await vault.allMeta()
    for (const row of rows) {
      profile.noteCreated(row.id)
      if (row.clearedOn) profile.noteCleared(row.id)
    }
  } catch {
    /* místní uložení není */
  }
}

game.setSkin(profile.skin())
applyAds()
paintAuth()
show(auth)
mountBackdrop()
backfillProgress().then(async () => {
  try {
    const session = await account.me()
    if (session) {
      sessionStorage.removeItem(GUEST)
      await applySession(session)
      show(menu)
      return
    }
  } catch {
    /* bez sítě zůstane přihlašovací obrazovka */
  }
  if (sessionStorage.getItem(GUEST) === "1") show(menu)
  else show(auth)
})
