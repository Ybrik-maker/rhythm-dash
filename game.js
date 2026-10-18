import { checkpointFor, createBot, createPlayer, spawnPlayer, stepPlayer, PLAYER_W, PLAYER_H } from "./physics.js"
import { drawSkin } from "./skins.js"

const ATTRACT = {
  speed: 280,
  duration: 24,
  airTime: 0.42,
  jumpV: 740,
  gravity: 3500,
  palette: {
    skyTop: "#102033",
    skyBottom: "#070b12",
    accent: "#2ee6ff",
    accent2: "#ff4d8d",
    ground: "#121a24",
    groundEdge: "#7af0ff",
    spike: "#2ad4ff",
    spikeShade: "#0e6d86",
    block: "#ffb703",
    blockShade: "#b45309",
    player: "#f5f8fc",
    playerMark: "#2ee6ff",
    portal: "#d6ff4a",
    deco: "#49d6ff",
    text: "#f7fbff",
  },
  motif: "triangles",
  obstacles: [
    { kind: "spike", x: 640, w: 34, h: 50, jumpAt: 1 },
    { kind: "spike", x: 980, w: 34, h: 50, jumpAt: 2 },
    { kind: "block", x: 1320, w: 46, h: 44, jumpAt: 3 },
    { kind: "double", x: 1680, w: 74, h: 50, jumpAt: 4 },
    { kind: "spike", x: 2100, w: 34, h: 50, jumpAt: 5 },
  ],
  decorations: [],
  groundDeco: [],
  beats: [],
  finishTime: 24,
  clearAt: 20,
  energyAt: () => 0.55,
}

for (let time = 0; time < ATTRACT.duration; time += 0.48) ATTRACT.beats.push(time)
for (let x = 0; x < ATTRACT.duration * ATTRACT.speed; x += 240) {
  ATTRACT.decorations.push({
    kind: "triangles",
    x,
    y: -160 - (x % 120),
    size: 40,
    rot: (x % 7) * 0.2,
    parallax: 0.3,
    alpha: 0.2,
  })
}
for (let x = 0; x < ATTRACT.duration * ATTRACT.speed; x += 72) {
  ATTRACT.groundDeco.push({ x, w: 64, h: 18 + ((x / 72) % 3) * 10 })
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, "0")}`
}

export function mountGame(canvas, hooks) {
  const ctx = canvas.getContext("2d")
  const particles = []
  const trail = []
  let mode = "attract"
  let level = ATTRACT
  let audio = null
  let player = createPlayer(0, ATTRACT.speed)
  let bot = null
  let prevT = 0
  let attractT = 0
  let attempts = 1
  const heldKeys = new Set()
  let pointerDown = false
  let dropBanner = 0
  let lastSection = ""
  let lastBurst = -1
  let shake = 0
  let deadTimer = 0
  let deathTime = 0
  let deathMode = "cube"
  let immortal = false
  let spawnAt = 0
  let attemptPop = 1.1
  let beatCursor = 0
  let camY = 0
  let gateFlash = 0
  let skin = null
  let backdrop = null
  let trace = []
  let segmentFrom = 0
  let raf = 0
  let last = performance.now()
  let sfx = null

  function phoneLandscape() {
    const w = window.innerWidth
    const h = window.innerHeight
    return w > h && h <= 520 && w < 1200
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(window.innerWidth * dpr)
    canvas.height = Math.floor(window.innerHeight * dpr)
    canvas.style.width = `${window.innerWidth}px`
    canvas.style.height = `${window.innerHeight}px`
    fitView()
  }

  function fitView() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const view = viewSize()
    const scale = window.innerWidth / view.w
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
  }

  function ensureSfx() {
    if (sfx) return sfx
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    sfx = new Ctx()
    return sfx
  }

  function blip(kind) {
    const context = ensureSfx()
    if (!context) return
    if (context.state === "suspended") context.resume()
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.connect(gain)
    gain.connect(context.destination)
    const now = context.currentTime
    if (kind === "jump") {
      osc.type = "square"
      osc.frequency.setValueAtTime(680, now)
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.06)
      gain.gain.setValueAtTime(0.035, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
      osc.start(now)
      osc.stop(now + 0.08)
    } else if (kind === "die") {
      osc.type = "sawtooth"
      osc.frequency.setValueAtTime(280, now)
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.24)
      gain.gain.setValueAtTime(0.05, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.start(now)
      osc.stop(now + 0.26)
    } else if (kind === "gate") {
      osc.type = "square"
      osc.frequency.setValueAtTime(640, now)
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.1)
      gain.gain.setValueAtTime(0.03, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
      osc.start(now)
      osc.stop(now + 0.13)
    } else if (kind === "pad") {
      osc.type = "square"
      osc.frequency.setValueAtTime(520, now)
      osc.frequency.exponentialRampToValueAtTime(980, now + 0.08)
      gain.gain.setValueAtTime(0.04, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)
      osc.start(now)
      osc.stop(now + 0.13)
    } else if (kind === "win") {
      osc.type = "square"
      osc.frequency.setValueAtTime(440, now)
      osc.frequency.setValueAtTime(660, now + 0.09)
      osc.frequency.setValueAtTime(880, now + 0.18)
      gain.gain.setValueAtTime(0.04, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36)
      osc.start(now)
      osc.stop(now + 0.38)
    }
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random()
      const speed = 80 + Math.random() * 260
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life: 0.45 + Math.random() * 0.35,
        age: 0,
        size: 4 + Math.random() * 6,
        color,
      })
    }
  }

  function shipSpan(time) {
    return (level.flight || []).find((span) => time >= span.start - 0.04 && time <= span.end + 0.25)
  }

  function resetRun(time, asShip = false) {
    player = spawnPlayer(level, time, { immortal, asShip })
    segmentFrom = time
    trace = []
    prevT = time
    spawnAt = time
    beatCursor = 0
    attemptPop = 1.15
    camY = player.y
    gateFlash = 0
    trail.length = 0
  }

  function die() {
    if (mode !== "play") return
    mode = "dead"
    deadTimer = 0.62
    deathMode = player.mode
    deathTime = audio ? audio.currentTime : prevT
    shake = 1
    audio?.pause()
    blip("die")
    report(false, true)
    const view = viewSize()
    const sy = level.floors?.length ? worldY(player.y, view) : view.ground + player.y
    burst(view.w * 0.3, sy - 20, level.palette.accent2, 22)
  }

  function win() {
    if (mode === "win") return
    mode = "win"
    blip("win")
    hooks.onWin?.({
      attempts,
      immortal,
      title: level.title,
      songName: level.songName,
      time: formatTime(level.duration),
    })
    report(true, true)
  }

  function report(cleared = false, withReplay = false) {
    if (!level || level === ATTRACT || !level.id) return
    const time = cleared ? level.duration : (audio ? audio.currentTime : prevT)
    const replay = withReplay ? { from: segmentFrom, immortal, frames: trace } : null
    if (withReplay) trace = []
    hooks.onRun?.({
      id: level.id,
      attempts,
      immortal,
      percent: Math.min(100, Math.round((time / Math.max(0.001, level.duration)) * 100)),
      cleared,
      replay,
    })
  }

  function respawn() {
    let mark = checkpointFor(level, deathTime)
    const diedShip = deathMode === "ship"
    if (diedShip) {
      const span = shipSpan(deathTime) || (level.flight || []).find((item) => deathTime >= item.start - 0.2 && deathTime <= item.end + 0.6)
      if (span) {
        const marks = (level.checkpoints || []).filter((item) => item >= span.start - 0.02 && item <= deathTime + 0.02 && item < span.end)
        mark = marks.length ? marks[marks.length - 1] : span.start
        if (mark < span.start) mark = span.start
      }
    }
    attempts += 1
    report(false)
    if (audio) audio.currentTime = mark
    resetRun(mark, diedShip)
    mode = "play"
    audio?.play()
  }

  function worldY(y, view) {
    return view.h * 0.72 + (y - camY)
  }

  function followCamera(dt) {
    const blend = 1 - Math.exp(-5 * Math.max(0.001, dt))
    camY += (player.y - camY) * blend
  }

  function viewSize() {
    const screenW = window.innerWidth
    const screenH = window.innerHeight
    if (!phoneLandscape()) {
      return {
        w: screenW,
        h: screenH,
        ground: Math.round(screenH * 0.76),
      }
    }
    const w = 1366
    const h = screenH * (w / screenW)
    return {
      w,
      h,
      ground: Math.round(h * 0.76),
    }
  }

  function sectionType(time) {
    const sections = level.sections
    if (!sections?.length) return null
    for (const section of sections) {
      if (time >= section.start && time < section.end) return section.type
    }
    return sections[sections.length - 1].type
  }

  function beatPulse(time) {
    const beats = level.beats || []
    if (!beats.length) return 0
    if (beatCursor >= beats.length || beats[beatCursor] > time + 0.25) beatCursor = 0
    while (beatCursor < beats.length - 1 && beats[beatCursor + 1] < time) beatCursor += 1
    let best = 1
    for (let i = Math.max(0, beatCursor - 1); i <= Math.min(beats.length - 1, beatCursor + 1); i += 1) {
      best = Math.min(best, Math.abs(beats[i] - time))
    }
    return Math.exp(-best * best * 90)
  }

  function jumpCue(time) {
    const list = level.obstacles || []
    let best = 1
    for (let i = 0; i < list.length; i += 1) {
      const distance = Math.abs(list[i].jumpAt - time)
      if (distance < best) best = distance
    }
    return Math.exp(-best * best * 70)
  }

  function drawBackground(view, camera, time) {
    const { palette } = level
    const gradient = ctx.createLinearGradient(0, 0, 0, view.h)
    gradient.addColorStop(0, palette.skyTop)
    gradient.addColorStop(1, palette.skyBottom)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, view.w, view.h)

    const pulse = beatPulse(time)
    ctx.fillStyle = palette.accent
    ctx.globalAlpha = 0.045 + pulse * 0.06
    ctx.fillRect(0, 0, view.w, view.h)
    const tint = {
      rise: "rgba(255, 170, 70, 0.07)",
      drop: "rgba(255, 60, 110, 0.09)",
      break: "rgba(90, 110, 255, 0.08)",
      outro: "rgba(70, 255, 190, 0.08)",
    }[sectionType(time)]
    if (tint) {
      ctx.fillStyle = tint
      ctx.globalAlpha = 1
      ctx.fillRect(0, 0, view.w, view.h)
    }
    ctx.globalAlpha = 1

    if (camY < -36) {
      ctx.fillStyle = "#ffffff"
      ctx.globalAlpha = Math.min(0.75, (-camY - 36) / 220)
      for (let i = 0; i < 48; i += 1) {
        const sx = ((i * 137 + Math.floor(camera * 0.12)) % (view.w + 40)) - 20
        const sy = (i * 67) % Math.max(40, view.h * 0.78)
        ctx.fillRect(sx, sy, i % 6 === 0 ? 3 : 2, i % 6 === 0 ? 3 : 2)
      }
      ctx.globalAlpha = 1
    }

    for (const deco of level.decorations) {
      const sx = deco.x - camera * deco.parallax
      if (sx < -120 || sx > view.w + 120) continue
      const anchor = level.floors?.length ? worldY(0, view) : view.ground
      const sy = anchor + deco.y
      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(deco.rot + time * 0.15)
      ctx.globalAlpha = deco.alpha
      ctx.strokeStyle = palette.deco
      ctx.fillStyle = palette.deco
      ctx.lineWidth = 2
      const s = deco.size
      if (deco.kind === "rings") {
        ctx.beginPath()
        ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2)
        ctx.stroke()
      } else if (deco.kind === "beams") {
        ctx.fillRect(-s / 2, -4, s, 8)
      } else if (deco.kind === "shards") {
        ctx.beginPath()
        ctx.moveTo(0, -s / 2)
        ctx.lineTo(s / 3, s / 2)
        ctx.lineTo(-s / 3, s / 2)
        ctx.closePath()
        ctx.stroke()
      } else if (deco.kind === "saw") {
        ctx.beginPath()
        ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2)
        ctx.stroke()
        for (let tooth = 0; tooth < 6; tooth += 1) {
          ctx.rotate(Math.PI / 3)
          ctx.fillRect(-2, s * 0.2, 4, s * 0.22)
        }
      } else if (deco.kind === "orb") {
        ctx.globalAlpha = deco.alpha
        ctx.shadowColor = palette.accent
        ctx.shadowBlur = 12
        ctx.beginPath()
        ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.moveTo(0, -s / 2)
        ctx.lineTo(s / 2, s / 3)
        ctx.lineTo(-s / 2, s / 3)
        ctx.closePath()
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  function drawUnderFloor(sx, y, width, floor, palette, pulse, viewW) {
    const seed = Math.floor(floor.x / 48)
    ctx.save()
    let x = sx + 4
    const limit = Math.min(sx + width - 8, viewW + 48)
    if (x < -48) x += Math.ceil((-48 - x) / 34) * 34
    for (; x < limit; x += 34) {
      const n = Math.abs(Math.floor((x + seed * 17) / 34))
      const mode = (n + seed) % 4
      const hang = 28 + (n % 6) * 18 + (floor.hot ? 16 : 0)
      if (mode === 0) {
        ctx.fillStyle = palette.block
        ctx.globalAlpha = 0.85
        ctx.fillRect(x, y, 16, hang)
        ctx.fillStyle = palette.blockShade
        ctx.fillRect(x + 16, y, 8, hang * 0.72)
      } else if (mode === 1) {
        ctx.fillStyle = palette.spike
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + 15, y + hang)
        ctx.lineTo(x + 30, y)
        ctx.closePath()
        ctx.fill()
      } else if (mode === 2) {
        ctx.fillStyle = palette.groundEdge
        ctx.globalAlpha = 0.35 + pulse * 0.15
        const bricks = 2 + (n % 3)
        for (let i = 0; i < bricks; i += 1) {
          ctx.fillRect(x + i * 3, y + i * 16, 26 - i * 4, 12)
        }
      } else {
        ctx.fillStyle = palette.accent
        ctx.globalAlpha = 0.55
        const links = 3 + (n % 3)
        for (let i = 0; i < links; i += 1) {
          ctx.fillRect(x + 8, y + i * 16, 10, 9)
        }
        ctx.fillStyle = palette.accent2
        ctx.fillRect(x + 6, y + links * 16, 14, 14)
      }
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  function drawFloors(view, camera, time) {
    const { palette } = level
    const pulse = beatPulse(time)
    for (const floor of level.floors) {
      const sx = floor.x - camera
      if (sx > view.w + 30 || sx + floor.w < -30) continue
      const top = worldY(floor.top, view)
      const thick = 78
      const hot = Boolean(floor.hot)
      ctx.fillStyle = hot ? palette.blockShade : palette.ground
      ctx.fillRect(sx, top, floor.w, thick)
      if (hot) {
        ctx.globalAlpha = 0.18 + pulse * 0.2
        ctx.fillStyle = palette.accent2
        ctx.fillRect(sx, top, floor.w, 10)
        ctx.globalAlpha = 1
      }
      drawUnderFloor(sx, top + thick, floor.w, floor, palette, pulse, view.w)
      ctx.globalAlpha = 1
      ctx.strokeStyle = hot ? palette.accent2 : palette.groundEdge
      ctx.lineWidth = hot ? 6 : 3
      ctx.shadowColor = hot ? palette.accent2 : palette.accent
      ctx.shadowBlur = 12 + pulse * (hot ? 26 : 14)
      ctx.beginPath()
      ctx.moveTo(sx, top + 0.5)
      ctx.lineTo(sx + floor.w, top + 0.5)
      ctx.stroke()
      ctx.shadowBlur = 0
      for (const block of level.groundDeco || []) {
        if (block.x + block.w < floor.x || block.x > floor.x + floor.w) continue
        const bx = block.x - camera
        if (bx < -40 || bx > view.w + 20) continue
        ctx.fillStyle = hot ? palette.accent2 : palette.block
        ctx.globalAlpha = 0.45
        ctx.fillRect(bx, top + 16, block.w, Math.min(36, 12 + block.h * 0.35))
      }
      ctx.globalAlpha = 1
    }
    drawTunnel(view, camera, palette)
  }

  function drawGdCell(sx, sy, cell, palette, thick) {
    const gap = thick ? 1 : 2
    const inset = thick ? 2 : 3
    const inner = cell - (thick ? 5 : 8)
    ctx.fillStyle = palette.blockShade
    ctx.fillRect(sx, sy, cell - gap, cell - gap)
    ctx.fillStyle = palette.block
    ctx.fillRect(sx + inset, sy + inset, inner, inner)
    ctx.fillStyle = "rgba(255,255,255,0.55)"
    ctx.fillRect(sx + inset, sy + inset, inner, thick ? 8 : 3)
    if (thick) {
      ctx.fillStyle = "rgba(0,0,0,0.32)"
      ctx.fillRect(sx + inset, sy + inset + inner - 8, inner, 8)
    }
  }

  function drawGdGrid(camera, view, x0, x1, worldTop, worldBottom, palette, thick = false) {
    const cell = thick ? 54 : 34
    const left = Math.max(x0, camera - cell)
    const right = Math.min(x1, camera + view.w + cell)
    if (right - left < 8 || worldBottom - worldTop < 8) return
    for (let x = left - ((left - x0) % cell); x < right; x += cell) {
      for (let y = worldTop; y < worldBottom - 4; y += cell) {
        const sx = x - camera
        const sy = worldY(y, view)
        if (sy > view.h + 8 || sy + cell < -8) continue
        drawGdCell(sx, sy, cell, palette, thick)
      }
    }
  }

  function drawTunnel(view, camera, palette) {
    for (const span of level.flight || []) {
      if (span.shells?.length) {
        for (const shell of span.shells) {
          if (shell.x - camera > view.w + 40 || shell.x + shell.w - camera < -40) continue
          drawGdGrid(camera, view, shell.x, shell.x + shell.w, shell.ceil - 280, shell.ceil, palette, true)
          drawGdGrid(camera, view, shell.x, shell.x + shell.w, shell.floor, shell.floor + 180, palette, true)
          ctx.strokeStyle = shell.narrow ? "#fff4a8" : palette.accent2
          ctx.lineWidth = shell.narrow ? 8 : 7
          ctx.beginPath()
          ctx.moveTo(shell.x - camera, worldY(shell.ceil, view))
          ctx.lineTo(shell.x + shell.w - camera, worldY(shell.ceil, view))
          ctx.moveTo(shell.x - camera, worldY(shell.floor, view))
          ctx.lineTo(shell.x + shell.w - camera, worldY(shell.floor, view))
          ctx.stroke()
        }
        continue
      }
      if (span.shellTop == null || span.shellFrom == null) continue
      const x0 = span.shellFrom
      const x1 = span.shellTo
      if (x0 - camera > view.w + 40 || x1 - camera < -40) continue
      drawGdGrid(camera, view, x0, x1, span.shellTop - 640, span.shellTop, palette, true)
      if (span.floorTop != null) drawGdGrid(camera, view, x0, x1, span.floorTop, span.floorTop + 280, palette, true)
      for (const pillar of span.pillars || []) {
        if (pillar.x - camera > view.w + 20 || pillar.x + pillar.w - camera < -20) continue
        drawGdGrid(camera, view, pillar.x, pillar.x + pillar.w, pillar.top, pillar.bottom, palette, true)
      }
      const lip = worldY(span.shellTop, view)
      const sx = x0 - camera
      ctx.strokeStyle = palette.accent2
      ctx.lineWidth = 3
      ctx.shadowColor = palette.accent2
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(sx, lip + 0.5)
      ctx.lineTo(sx + (x1 - x0), lip + 0.5)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  function drawPads(view, camera) {
    for (const pad of level.pads || []) {
      const color = pad.color === "pink" ? "#ff4fa3" : pad.color === "red" ? "#ff5a5a" : (level.palette.pad || "#ffe14a")
      const sx = pad.x - camera
      if (sx > view.w + 20 || sx + pad.w < -20) continue
      const top = worldY(pad.top, view)
      ctx.save()
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 18
      ctx.beginPath()
      ctx.moveTo(sx + 6, top)
      ctx.lineTo(sx + pad.w - 6, top)
      ctx.lineTo(sx + pad.w - 14, top - 18)
      ctx.lineTo(sx + 14, top - 18)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = "#fff8c4"
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(sx + 16, top - 6)
      ctx.lineTo(sx + pad.w / 2, top - 14)
      ctx.lineTo(sx + pad.w - 16, top - 6)
      ctx.stroke()
      ctx.restore()
    }
  }

  function drawVoidGlow(view) {
    const x = player.x + PLAYER_W * 0.5
    const overHole = !(level.floors || []).some((floor) => x >= floor.x && x <= floor.x + floor.w)
    if (!overHole || player.onGround) return
    const gradient = ctx.createRadialGradient(view.w * 0.32, view.h * 0.78, 20, view.w * 0.32, view.h, view.h * 0.55)
    gradient.addColorStop(0, "rgba(255, 40, 70, 0)")
    gradient.addColorStop(1, "rgba(255, 30, 60, 0.28)")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, view.w, view.h)
  }

  function drawTerrain(view, camera, time) {
    if (level.floors?.length) {
      drawFloors(view, camera, time)
      drawPads(view, camera)
      drawVoidGlow(view)
      return
    }
    drawGround(view, camera, time)
  }

  function drawGround(view, camera, time) {
    const { palette } = level
    ctx.fillStyle = palette.ground
    ctx.fillRect(0, view.ground, view.w, view.h - view.ground)
    for (const block of level.groundDeco) {
      const sx = block.x - camera
      if (sx < -80 || sx > view.w + 20) continue
      ctx.fillStyle = palette.accent2
      ctx.globalAlpha = 0.28
      ctx.fillRect(sx, view.ground + 10, block.w, block.h)
    }
    ctx.globalAlpha = 1
    const pulse = beatPulse(time)
    const drop = sectionType(time) === "drop"
    ctx.strokeStyle = palette.groundEdge
    ctx.lineWidth = drop ? 6 : 4
    ctx.shadowColor = drop ? palette.accent2 : palette.accent
    ctx.shadowBlur = 12 + pulse * (drop ? 28 : 18)
    ctx.beginPath()
    ctx.moveTo(0, view.ground)
    ctx.lineTo(view.w, view.ground)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 0.18 + pulse * 0.45
    ctx.fillStyle = palette.groundEdge
    ctx.fillRect(0, view.ground - 2, view.w, 5)
    ctx.globalAlpha = 1
  }

  function drawSpike(sx, ground, w, h, _fill, _shade, flip) {
    const width = Math.max(16, w)
    const height = Math.max(18, h)
    const tip = flip ? ground + height : ground - height
    ctx.save()
    ctx.shadowColor = "#ff2b4a"
    ctx.shadowBlur = 16
    ctx.fillStyle = "#2a0610"
    ctx.beginPath()
    ctx.moveTo(sx - 2, ground)
    ctx.lineTo(sx + width + 2, ground)
    ctx.lineTo(sx + width / 2, tip)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = "#ff2b4a"
    ctx.beginPath()
    ctx.moveTo(sx + 3, ground)
    ctx.lineTo(sx + width - 3, ground)
    ctx.lineTo(sx + width / 2, tip + (flip ? -6 : 6))
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = "#fff5f7"
    ctx.beginPath()
    ctx.moveTo(sx + width * 0.38, ground)
    ctx.lineTo(sx + width * 0.62, ground)
    ctx.lineTo(sx + width / 2, tip + (flip ? -10 : 10))
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(sx, ground)
    ctx.lineTo(sx + width, ground)
    ctx.lineTo(sx + width / 2, tip)
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  }

  function drawSolid(sx, ground, obstacle, fill, shade) {
    const top = ground - obstacle.h
    ctx.fillStyle = shade
    ctx.fillRect(sx + 6, top + 8, obstacle.w, obstacle.h)
    ctx.fillStyle = fill
    ctx.fillRect(sx, top, obstacle.w, obstacle.h)
    ctx.fillStyle = "rgba(255,255,255,0.55)"
    ctx.fillRect(sx, top, obstacle.w, 6)
    ctx.strokeStyle = "rgba(255,255,255,0.35)"
    ctx.strokeRect(sx + 1.5, top + 1.5, obstacle.w - 3, obstacle.h - 3)
  }

  function drawSawObstacle(sx, ground, obstacle, time) {
    const r = obstacle.w / 2
    ctx.save()
    ctx.translate(sx + r, ground - r + 4)
    ctx.rotate(time * 10)
    ctx.fillStyle = level.palette.accent2
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = level.palette.spike
    for (let tooth = 0; tooth < 8; tooth += 1) {
      ctx.rotate(Math.PI / 4)
      ctx.beginPath()
      ctx.moveTo(-5, r * 0.35)
      ctx.lineTo(5, r * 0.35)
      ctx.lineTo(0, r * 0.98)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  function drawSpikeRow(sx, ground, obstacle, count) {
    const { palette } = level
    const gap = 6
    const w = (obstacle.w - gap * (count - 1)) / count
    for (let index = 0; index < count; index += 1) {
      drawSpike(sx + index * (w + gap), ground, w, obstacle.h, palette.spike, palette.spikeShade, obstacle.flip)
    }
  }

  function isSpikeKind(kind) {
    return kind === "spike" || kind === "double" || kind === "triple" || kind === "quad"
  }

  function drawObstacles(view, camera, time, spikesOnly = false) {
    const { palette } = level
    for (const obstacle of level.obstacles) {
      if (obstacle.kind === "cue" || obstacle.kind === "pad") continue
      if (spikesOnly !== isSpikeKind(obstacle.kind)) continue
      const sx = obstacle.x - camera
      if (sx < -200 || sx > view.w + 80) continue
      const ground = level.floors?.length ? worldY(obstacle.base ?? 0, view) : view.ground
      const spikeFill = "#ff2b4a"
      const spikeShade = "#fff5f7"
      if (obstacle.kind === "platform" || obstacle.kind === "block" || obstacle.kind === "pillar") {
        drawSolid(sx, ground, obstacle, palette.block, palette.blockShade)
      } else if (obstacle.kind === "saw") {
        drawSawObstacle(sx, ground, obstacle, time)
      } else if (obstacle.kind === "double") {
        drawSpikeRow(sx, ground, obstacle, 2)
      } else if (obstacle.kind === "triple") {
        drawSpikeRow(sx, ground, obstacle, 3)
      } else if (obstacle.kind === "quad") {
        drawSpikeRow(sx, ground, obstacle, 4)
      } else {
        drawSpike(sx, ground, obstacle.w, obstacle.h, spikeFill, spikeShade, obstacle.flip)
      }
    }
    if (!spikesOnly) {
      drawOrbs(view, camera)
      drawModePortals(view, camera)
    }
  }

  function drawOrbs(view, camera) {
    for (const orb of level.orbs || []) {
      const sx = orb.x - camera
      if (sx < -40 || sx > view.w + 40) continue
      const sy = level.floors?.length ? worldY(orb.y, view) : view.ground + orb.y
      const color = orb.color === "pink" ? "#ff4fa3" : orb.color === "blue" ? "#4db7ff" : "#ffe14a"
      ctx.save()
      ctx.translate(sx, sy)
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 16
      ctx.beginPath()
      ctx.arc(0, 0, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = "rgba(255,255,255,0.85)"
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, 18, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  function drawModePortals(view, camera) {
    for (const portal of level.portals || []) {
      const sx = portal.x - camera
      if (sx < -80 || sx > view.w + 80) continue
      const top = level.floors?.length ? worldY(portal.top, view) : view.ground
      const color = portal.mode === "ship" ? "#49e4ff" : "#8dff6a"
      const tall = portal.mode === "cube" ? 240 : 116
      const lift = portal.mode === "cube" ? 120 : 78
      ctx.save()
      ctx.translate(sx + 18, top - lift)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 18
      ctx.lineWidth = 5
      ctx.strokeRect(-22, -tall / 2, 44, tall)
      ctx.globalAlpha = 0.2
      ctx.fillRect(-22, -tall / 2, 44, tall)
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      ctx.beginPath()
      if (portal.mode === "ship") {
        ctx.moveTo(-12, 10)
        ctx.lineTo(16, 0)
        ctx.lineTo(-12, -10)
      } else {
        ctx.rect(-8, -8, 16, 16)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  function drawRing(sx, cy, color, label) {
    const pulse = 0.85 + Math.sin(performance.now() / 160) * 0.15
    ctx.save()
    ctx.translate(sx, cy)
    ctx.strokeStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = 18
    ctx.lineWidth = 4
    for (let i = 0; i < 3; i += 1) {
      ctx.globalAlpha = 0.9 - i * 0.22
      ctx.beginPath()
      ctx.ellipse(0, 0, 16 + i * 8, (58 + i * 10) * pulse, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 0.28
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(0, 0, 14, 52 * pulse, 0, 0, Math.PI * 2)
    ctx.fill()
    if (label) {
      ctx.globalAlpha = 1
      ctx.fillStyle = color
      ctx.font = "700 22px Russo One, Impact, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText(label, 0, -86)
    }
    ctx.restore()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
  }

  function drawPortal(view, camera) {
    const finishX = level.xAt ? level.xAt(level.finishTime) : level.finishTime * level.speed
    const sx = finishX - camera
    if (sx < -80 || sx > view.w + 80) return
    const { palette } = level
    let base = view.ground - 78
    if (level.floors?.length) {
      const floor = [...level.floors].reverse().find((item) => finishX >= item.x && finishX <= item.x + item.w)
      base = worldY(floor ? floor.top : camY, view) - 78
    }
    drawRing(sx, base, palette.portal, "END")
  }

  function drawGates(view, camera) {
    for (const gate of level.gates || []) {
      const sx = gate.x - camera
      if (sx < -90 || sx > view.w + 90) continue
      const cy = (level.floors?.length ? worldY(gate.top, view) : view.ground) - 74
      const color = gate.role === "exit" ? level.palette.accent2 : gate.role === "enter" ? (level.palette.pad || "#ffe14a") : level.palette.portal
      drawRing(sx, cy, color, "")
    }
  }

  function drawPlayer(view, camera, ghost) {
    const sx = player.x - camera
    const sy = level.floors?.length ? worldY(player.y, view) : view.ground + player.y
    trail.push({ x: sx + PLAYER_W / 2, y: sy - PLAYER_H / 2, a: 0.45 })
    if (trail.length > 14) trail.shift()
    const look = {
      shape: skin?.shape || "slab",
      cube: skin?.cube || level.palette.player,
      mark: skin?.mark || level.palette.playerMark,
      ship: skin?.ship || level.palette.player,
      flame: skin?.flame || "#49e4ff",
    }
    trail.forEach((bit, index) => {
      ctx.globalAlpha = (index / trail.length) * bit.a * (ghost ? 0.4 : 1)
      ctx.fillStyle = look.mark
      ctx.fillRect(bit.x - 4, bit.y - 4, 8, 8)
    })
    ctx.globalAlpha = ghost ? 0.75 : player.invuln > 0 && Math.sin(performance.now() / 40) > 0 ? 0.35 : 1
    ctx.save()
    ctx.translate(sx + PLAYER_W / 2, sy - PLAYER_H / 2)
    ctx.rotate(player.mode === "ship" ? player.spin : player.spin)
    ctx.shadowColor = player.mode === "ship" ? look.flame : look.mark
    ctx.shadowBlur = 8
    drawSkin(ctx, look, player.mode === "ship" ? "ship" : "cube")
    ctx.shadowBlur = 0
    ctx.restore()
    ctx.globalAlpha = 1

    if (!ghost && player.onGround && jumpCue(audio ? audio.currentTime : attractT) > 0.45 && mode === "play") {
      ctx.strokeStyle = level.palette.accent
      ctx.lineWidth = 3
      ctx.globalAlpha = 0.8
      ctx.strokeRect(sx - 4, sy - PLAYER_H - 4, PLAYER_W + 8, PLAYER_H + 8)
      ctx.globalAlpha = 1
    }
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const bit = particles[i]
      bit.age += dt
      bit.vy += 520 * dt
      bit.x += bit.vx * dt
      bit.y += bit.vy * dt
      const life = 1 - bit.age / bit.life
      if (life <= 0) {
        particles.splice(i, 1)
        continue
      }
      ctx.globalAlpha = life
      ctx.fillStyle = bit.color
      ctx.fillRect(bit.x, bit.y, bit.size, bit.size)
    }
    ctx.globalAlpha = 1
  }

  function drawSpeedLines(view, time, intensity) {
    if (intensity <= 0) return
    const pace = level.paceAt ? level.paceAt(time) : level.speed || 400
    const shift = (time * pace * 1.8) % 160
    ctx.save()
    ctx.strokeStyle = level.palette.accent
    ctx.globalAlpha = 0.16 * intensity + beatPulse(time) * 0.28 * intensity
    ctx.lineWidth = intensity > 0.8 ? 3 : 2
    for (let i = 0; i < (intensity > 0.8 ? 28 : 18); i += 1) {
      const span = intensity > 0.8 ? view.h : Math.max(40, view.ground - 8)
      const y = (i * 46 + shift) % span
      ctx.beginPath()
      ctx.moveTo(view.w, y)
      ctx.lineTo(view.w - (70 + (i % 4) * 48) * intensity, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawDropField(view, time) {
    if (sectionType(time) !== "drop") return
    const pulse = beatPulse(time)
    ctx.save()
    ctx.fillStyle = level.palette.accent2
    ctx.globalAlpha = 0.1 + pulse * 0.22
    ctx.fillRect(0, 0, view.w, view.h)
    ctx.globalAlpha = 0.4 + pulse * 0.5
    ctx.fillRect(0, 0, 12, view.h)
    ctx.fillRect(view.w - 12, 0, 12, view.h)
    ctx.fillStyle = level.palette.accent
    ctx.fillRect(0, 0, view.w, 7)
    ctx.fillRect(0, view.h - 7, view.w, 7)
    ctx.globalAlpha = 0.9
    ctx.font = "700 28px Russo One, Impact, sans-serif"
    ctx.textAlign = "center"
    ctx.lineWidth = 6
    ctx.strokeStyle = "rgba(0,0,0,0.72)"
    ctx.fillStyle = "#ffffff"
    ctx.strokeText("DROP", view.w / 2, 158)
    ctx.fillText("DROP", view.w / 2, 158)
    ctx.restore()
  }

  function drawDropBanner(view) {
    if (dropBanner <= 0) return
    ctx.save()
    ctx.globalAlpha = Math.min(1, dropBanner)
    ctx.textAlign = "center"
    ctx.font = "700 92px Russo One, Impact, sans-serif"
    ctx.lineWidth = 12
    ctx.strokeStyle = "rgba(0,0,0,0.72)"
    ctx.fillStyle = level.palette.accent2
    ctx.strokeText("DROP", view.w / 2, view.h * 0.33)
    ctx.fillText("DROP", view.w / 2, view.h * 0.33)
    ctx.restore()
  }

  function drawHud(view, time) {
    if (mode !== "play" && mode !== "dead") return
    const percent = Math.min(100, Math.floor((time / level.duration) * 100))
    ctx.textAlign = "center"
    ctx.font = "700 54px Russo One, Impact, sans-serif"
    ctx.lineWidth = 8
    ctx.strokeStyle = "rgba(0,0,0,0.72)"
    ctx.fillStyle = "#ffffff"
    ctx.strokeText(`${percent}%`, view.w / 2, 72)
    ctx.fillText(`${percent}%`, view.w / 2, 72)
    ctx.font = "700 28px Russo One, Impact, sans-serif"
    ctx.strokeText(`Attempt ${attempts}`, view.w / 2, 112)
    ctx.fillText(`Attempt ${attempts}`, view.w / 2, 112)

    ctx.font = "600 16px Sora, Segoe UI, sans-serif"
    ctx.textAlign = "left"
    ctx.fillStyle = "rgba(255,255,255,0.88)"
    ctx.strokeStyle = "rgba(0,0,0,0.55)"
    ctx.lineWidth = 4
    const scale = window.innerWidth / view.w
    const textX = 64 / scale
    const left = level.songName || level.title
    ctx.strokeText(left, textX, 42)
    ctx.fillText(left, textX, 42)
    ctx.font = "600 14px Sora, Segoe UI, sans-serif"
    ctx.fillStyle = "rgba(255,255,255,0.62)"
    ctx.strokeText(`${Math.round(level.bpm)} BPM`, textX, 64)
    ctx.fillText(`${Math.round(level.bpm)} BPM`, textX, 64)

    ctx.textAlign = "right"
    ctx.fillStyle = "rgba(255,255,255,0.7)"
    const hint = player.mode === "ship" ? "ship: hold = up, release = down" : "hold jump   ·   orb = tap   ·   gap = fall"
    const hintY = document.body.classList.contains("ads-live") ? 108 / scale : 24
    ctx.strokeText(`${hint}   ·   P pause`, view.w - 28, view.h - hintY)
    ctx.fillText(`${hint}   ·   P pause`, view.w - 28, view.h - hintY)

    if (attemptPop > 0) {
      ctx.globalAlpha = Math.min(1, attemptPop)
      ctx.textAlign = "center"
      ctx.font = "700 42px Russo One, Impact, sans-serif"
      ctx.fillStyle = "#ffffff"
      ctx.strokeText(`ATTEMPT ${attempts}`, view.w / 2, view.h * 0.42)
      ctx.fillText(`ATTEMPT ${attempts}`, view.w / 2, view.h * 0.42)
      ctx.globalAlpha = 1
    }

    if (mode === "dead") {
      ctx.textAlign = "center"
      ctx.font = "700 64px Russo One, Impact, sans-serif"
      ctx.fillStyle = level.palette.accent2
      ctx.strokeText("CRASH", view.w / 2, view.h * 0.58)
      ctx.fillText("CRASH", view.w / 2, view.h * 0.58)
    }
  }

  function advance(from, to, allowInput) {
    const total = to - from
    if (total <= 0) return { dead: false }
    const steps = Math.max(1, Math.ceil(total / (1 / 240)))
    const dt = total / steps
    let cursor = from
    let jumped = false
    let launched = false
    let traced = false
    for (let i = 0; i < steps; i += 1) {
      cursor = Math.min(to, cursor + dt)
      const held = allowInput && (pointerDown || heldKeys.size > 0)
      if (mode === "play" && !traced) {
        trace.push([to, held ? 1 : 0])
        traced = true
      }
      const controlled = mode === "preview" && bot ? bot.want(cursor, player) : held
      const result = stepPlayer(player, level, cursor, dt, controlled)
      if (result.jumped) {
        jumped = true
        if (mode === "play") blip("jump")
      }
      if (result.launched) {
        launched = true
        if (mode === "play") blip("pad")
      }
      if (result.transformed && mode === "play") blip(result.transformed === "ship" ? "pad" : "gate")
      if (result.dead) return { dead: true, jumped, launched }
    }
    return { dead: false, jumped, launched }
  }

  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000)
    last = now
    const view = viewSize()
    fitView()

    if (mode === "preview" || (mode === "attract" && bot)) {
      attractT += dt
      if (attractT >= level.duration) {
        attractT = 0
        player = createPlayer(0, level.speed)
        if (mode === "attract") player.immortal = true
        bot?.reset()
        beatCursor = 0
      }
      const result = advance(Math.max(0, attractT - dt), attractT, false)
      if (mode === "attract" && (result.dead || !player.alive)) {
        attractT = 0
        player = createPlayer(0, level.speed)
        player.immortal = true
        bot?.reset()
        beatCursor = 0
      }
      followCamera(dt)
      const focus = mode === "attract" && level.xAt ? level.xAt(attractT) : player.x
      const camera = focus - view.w * 0.3
      drawBackground(view, camera, attractT)
      drawSpeedLines(view, attractT, sectionType(attractT) === "drop" ? 1 : 0)
      drawTerrain(view, camera, attractT)
      drawObstacles(view, camera, attractT)
      drawDropField(view, attractT)
      drawObstacles(view, camera, attractT, true)
      drawPlayer(view, camera, true)
    } else if (mode === "attract") {
      ctx.fillStyle = "#07090e"
      ctx.fillRect(0, 0, view.w, view.h)
    } else if (mode === "play") {
      const time = audio ? audio.currentTime : prevT + dt
      const result = advance(prevT, time, true)
      prevT = time
      if (attemptPop > 0) attemptPop -= dt
      if (dropBanner > 0) dropBanner -= dt
      const section = sectionType(time)
      if (section === "drop" && lastSection !== "drop") {
        dropBanner = 1.35
        shake = Math.max(shake, 1.35)
        burst(view.w * 0.5, view.h * 0.42, "#ffffff", 36)
        burst(view.w * 0.3, view.h * 0.55, level.palette.accent2, 24)
      }
      lastSection = section || ""
      const pulse = beatPulse(time)
      if (section === "drop" && pulse > 0.45 && time - lastBurst > 0.06) {
        lastBurst = time
        burst(view.w * 0.22, worldY(player.y, view) - 48, level.palette.accent, 22)
        burst(view.w * 0.78, view.h * 0.18, level.palette.accent2, 18)
        shake = Math.max(shake, 0.85)
      }
      if (time >= level.finishTime || audio?.ended) win()
      else if (result.dead) die()
      followCamera(dt)
      const camera = player.x - view.w * 0.3
      if (result.launched) burst(view.w * 0.3, worldY(player.y, view) - 10, level.palette.pad || "#ffe14a", 18)
      ctx.save()
      if (shake > 0) {
        shake -= dt
        ctx.translate((Math.random() - 0.5) * shake * 16, (Math.random() - 0.5) * shake * 10)
      }
      drawBackground(view, camera, time)
      drawSpeedLines(view, time, section === "drop" ? 1 : section === "rise" ? 0.35 : 0)
      drawTerrain(view, camera, time)
      drawObstacles(view, camera, time)
      drawPlayer(view, camera, false)
      drawParticles(dt)
      drawDropField(view, time)
      drawObstacles(view, camera, time, true)
      drawDropBanner(view)
      drawHud(view, time)
      ctx.restore()
      const percent = time / level.duration
      hooks.onProgress?.(percent)
    } else if (mode === "dead") {
      deadTimer -= dt
      const camera = player.x - view.w * 0.3
      drawBackground(view, camera, deathTime)
      drawTerrain(view, camera, deathTime)
      drawObstacles(view, camera, deathTime)
      drawDropField(view, deathTime)
      drawObstacles(view, camera, deathTime, true)
      drawParticles(dt)
      drawHud(view, deathTime)
      if (deadTimer <= 0) respawn()
    } else if (mode === "pause" || mode === "win") {
      const time = audio ? audio.currentTime : prevT
      followCamera(dt)
      const camera = player.x - view.w * 0.3
      drawBackground(view, camera, time)
      drawTerrain(view, camera, time)
      drawObstacles(view, camera, time)
      drawDropField(view, time)
      drawObstacles(view, camera, time, true)
      drawPlayer(view, camera, mode === "win")
      if (mode === "pause") drawHud(view, time)
    }

    raf = requestAnimationFrame(frame)
  }

  function jumpCode(code) {
    return code === "Space" || code === "ArrowUp" || code === "KeyW"
  }

  function onKey(event) {
    if (jumpCode(event.code)) {
      if (mode === "play") event.preventDefault()
      if (!event.repeat) heldKeys.add(event.code)
      return
    }
    if (event.repeat || mode !== "play") return
    if (event.code === "KeyP" || event.code === "Escape") {
      event.preventDefault()
      api.pauseToggle()
    } else if (event.code === "KeyR") {
      event.preventDefault()
      api.restart()
    }
  }

  function onKeyUp(event) {
    heldKeys.delete(event.code)
  }

  function onPointer(event) {
    if (mode !== "play" || event.target !== canvas) return
    pointerDown = true
    canvas.setPointerCapture?.(event.pointerId)
  }

  function onPointerEnd() {
    pointerDown = false
  }

  function onBlur() {
    pointerDown = false
    heldKeys.clear()
  }

  function beginBackdrop() {
    level = backdrop
    mode = "attract"
    audio?.pause()
    attractT = 0
    beatCursor = 0
    trail.length = 0
    player = createPlayer(0, backdrop.speed)
    player.immortal = true
    bot = createBot(backdrop)
    attemptPop = 0
    camY = 0
  }

  const api = {
    attract() {
      if (backdrop) {
        beginBackdrop()
        return
      }
      mode = "attract"
      level = ATTRACT
      bot = null
      audio?.pause()
      player = createPlayer(0, ATTRACT.speed)
      attemptPop = 0
    },
    setBackdrop(next) {
      backdrop = next
      if (mode === "attract") beginBackdrop()
    },
    preview(next) {
      level = next
      mode = "preview"
      attractT = 0
      beatCursor = 0
      trail.length = 0
      player = createPlayer(0, next.speed)
      bot = createBot(next)
    },
    async play(next, element, options = {}) {
      level = next
      audio = element
      immortal = Boolean(options.immortal)
      if (options.skin) skin = options.skin
      attempts = 1
      bot = null
      resetRun(0)
      mode = "play"
      ensureSfx()
      audio.currentTime = 0
      report(false)
      await audio.play()
    },
    pauseToggle() {
      if (mode === "play") {
        audio?.pause()
        mode = "pause"
        hooks.onPause?.(true)
      } else if (mode === "pause") {
        prevT = audio ? audio.currentTime : prevT
        mode = "play"
        audio?.play()
        hooks.onPause?.(false)
      }
    },
    async restart() {
      if (!audio || !level || level === ATTRACT) return
      attempts = 1
      audio.currentTime = 0
      resetRun(0)
      mode = "play"
      hooks.onPause?.(false)
      report(false)
      await audio.play()
    },
    stop() {
      audio?.pause()
      if (backdrop) beginBackdrop()
      else {
        mode = "attract"
        level = ATTRACT
        bot = null
      }
    },
    setSkin(next) {
      skin = next
    },
  }

  window.addEventListener("resize", resize)
  window.addEventListener("keydown", onKey)
  window.addEventListener("keyup", onKeyUp)
  window.addEventListener("pointerup", onPointerEnd)
  window.addEventListener("pointercancel", onPointerEnd)
  window.addEventListener("blur", onBlur)
  canvas.addEventListener("pointerdown", onPointer)
  resize()
  raf = requestAnimationFrame(frame)

  api.destroy = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener("resize", resize)
    window.removeEventListener("keydown", onKey)
    window.removeEventListener("keyup", onKeyUp)
    window.removeEventListener("pointerup", onPointerEnd)
    window.removeEventListener("pointercancel", onPointerEnd)
    window.removeEventListener("blur", onBlur)
    canvas.removeEventListener("pointerdown", onPointer)
  }

  return api
}

export { formatTime }
