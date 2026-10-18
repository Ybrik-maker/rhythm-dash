export const PLAYER_W = 40
export const PLAYER_H = 40
export const SHIP_THRUST = 460

export function createPlayer(t, speed) {
  return {
    x: t * speed,
    y: 0,
    vy: 0,
    onGround: true,
    coyote: 0.1,
    buffer: 0,
    airT: 0,
    spin: 0,
    alive: true,
    invuln: 0,
    held: false,
    grav: 1,
  }
}

function routeEase(u) {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

export function flightY(level, t) {
  const span = (level.flight || []).find((item) => t >= item.start && t < item.end)
  if (!span) return null
  if (span.route?.length) {
    const seg = span.route.find((item) => t >= item.t0 && t < item.t1) || (t < span.route[0].t0 ? span.route[0] : span.route[span.route.length - 1])
    if (t < seg.t0) return seg.y0
    if (t >= seg.t1) return seg.y1
    const spanT = Math.max(0.001, seg.t1 - seg.t0)
    const u = (t - seg.t0) / spanT
    return seg.y0 + (seg.y1 - seg.y0) * (seg.linear ? u : routeEase(u))
  }
  return span.center + Math.sin((t - span.start) * span.omega) * span.amp
}

export function createBot(level, slop = 0) {
  const jumps = [...new Set(level.obstacles.filter((o) => Number.isFinite(o.jumpAt)).map((o) => Math.round((o.jumpAt + slop) * 1000) / 1000))].sort(
    (a, b) => a - b,
  )
  let index = 0
  return {
    stepArmed: true,
    reset() {
      index = 0
      this.stepArmed = true
    },
    want(t, player) {
      if (player.mode === "ship") {
        const target = flightY(level, t + 0.045)
        if (target == null) return player.vy > 0
        return player.y + player.vy * 0.07 > target
      }
      while (index < jumps.length && t > jumps[index] + 0.07) index += 1
      if (index < jumps.length && t + 1e-4 >= jumps[index] && (player.onGround || player.coyote > 0)) {
        index += 1
        this.stepArmed = false
        return true
      }
      if (!player.onGround) this.stepArmed = true
      else if (this.stepArmed) {
        const speed = level.paceAt ? level.paceAt(t) : level.speed
        const step = (level.floors || []).find((floor) => floor.x > player.x + 16 && floor.x < player.x + speed * 0.27 && floor.top < player.y - 18)
        if (step) {
          this.stepArmed = false
          return true
        }
      }
      return false
    },
  }
}

function sign(ax, ay, bx, by, cx, cy) {
  return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
}

function pointInTri(p, tri) {
  const d1 = sign(p.x, p.y, tri[0].x, tri[0].y, tri[1].x, tri[1].y)
  const d2 = sign(p.x, p.y, tri[1].x, tri[1].y, tri[2].x, tri[2].y)
  const d3 = sign(p.x, p.y, tri[2].x, tri[2].y, tri[0].x, tri[0].y)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function segmentsIntersect(a, b, c, d) {
  const o1 = sign(b.x, b.y, a.x, a.y, c.x, c.y)
  const o2 = sign(b.x, b.y, a.x, a.y, d.x, d.y)
  const o3 = sign(d.x, d.y, c.x, c.y, a.x, a.y)
  const o4 = sign(d.x, d.y, c.x, c.y, b.x, b.y)
  return o1 * o2 < 0 && o3 * o4 < 0
}

function rectHitsTri(rect, tri) {
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ]
  for (const corner of corners) {
    if (pointInTri(corner, tri)) return true
  }
  for (const corner of tri) {
    if (corner.x >= rect.left && corner.x <= rect.right && corner.y >= rect.top && corner.y <= rect.bottom) {
      return true
    }
  }
  const rectEdges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]
  const triEdges = [
    [0, 1],
    [1, 2],
    [2, 0],
  ]
  for (const [a, b] of rectEdges) {
    for (const [c, d] of triEdges) {
      if (segmentsIntersect(corners[a], corners[b], tri[c], tri[d])) return true
    }
  }
  return false
}

function hitbox(p) {
  if (p.mode === "ship") {
    return {
      left: p.x + 14,
      right: p.x + PLAYER_W - 6,
      top: p.y - 30,
      bottom: p.y - 6,
    }
  }
  return {
    left: p.x + 10,
    right: p.x + PLAYER_W - 10,
    top: p.y - PLAYER_H + 8,
    bottom: p.y - 3,
  }
}

function oneSpike(x, w, h, base = 0, flip = false) {
  return [
    { x, y: base },
    { x: x + w / 2, y: flip ? base + h : base - h },
    { x: x + w, y: base },
  ]
}

function spikeTris(obstacle) {
  if (obstacle.tris) return obstacle.tris
  let tris
  if (obstacle.kind === "double" || obstacle.kind === "triple" || obstacle.kind === "quad") {
    const count = obstacle.kind === "quad" ? 4 : obstacle.kind === "triple" ? 3 : 2
    const gap = 6
    const w = (obstacle.w - gap * (count - 1)) / count
    tris = Array.from({ length: count }, (_, index) => oneSpike(obstacle.x + index * (w + gap), w, obstacle.h, obstacle.base || 0, obstacle.flip))
  } else {
    tris = [oneSpike(obstacle.x, obstacle.w, obstacle.h, obstacle.base || 0, obstacle.flip)]
  }
  obstacle.tris = tris
  return tris
}

function nearIndex(list, index, left) {
  if (!list || !list.length) return 0
  let i = index || 0
  if (i > list.length) i = list.length
  while (i > 0 && list[i - 1].x + (list[i - 1].w || 0) >= left) i -= 1
  while (i < list.length && list[i].x + (list[i].w || 0) < left) i += 1
  return i
}

function solidTop(obstacle) {
  return typeof obstacle.top === "number" ? obstacle.top : -(obstacle.h || 0)
}

function isSolid(kind) {
  return kind === "block" || kind === "platform" || kind === "pillar" || kind === "floor"
}

function blockSupport(p, level) {
  const footL = p.x + 8
  const footR = p.x + PLAYER_W - 8
  const holds = (obstacle) => {
    if (!isSolid(obstacle.kind)) return false
    if (Math.abs(p.y - solidTop(obstacle)) > 3) return false
    return footR > obstacle.x + 2 && footL < obstacle.x + obstacle.w - 2
  }
  for (const floor of level.floors || []) if (holds(floor)) return true
  const obstacles = level.obstacles || []
  const right = p.x + PLAYER_W
  for (let i = p.obsI || 0; i < obstacles.length; i += 1) {
    const obstacle = obstacles[i]
    if (obstacle.x > right) break
    if (holds(obstacle)) return true
  }
  return false
}

function collideBlock(p, obstacle, prevY) {
  const left = p.x + 6
  const right = p.x + PLAYER_W - 6
  const top = p.y - PLAYER_H + 4
  const bottom = p.y
  const bTop = solidTop(obstacle)
  const bBottom = bTop + (obstacle.thick || obstacle.h || 32)
  if (right <= obstacle.x || left >= obstacle.x + obstacle.w) return null
  if (bottom <= bTop - 2 || top >= bBottom) return null
  const sunk = bottom - bTop
  if (sunk <= 14) return "land"
  if (prevY <= bTop + 6 && sunk <= 24 && p.vy >= -30) return "land"
  if (p.vy < -120 && sunk <= 58) return "land"
  if ((p.launch || 0) > 0 && sunk <= 78) return "land"
  return "hurt"
}

function applyShipWall(p, wall, prevY, head, feet) {
  if (p.x + PLAYER_W - 4 <= wall.x || p.x + 4 >= wall.x + wall.w) return null
  if (wall.kind === "ceiling") {
    const lip = wall.lip + 2
    if (head < lip && feet > wall.lip - 400) {
      p.y += lip - head
      if (p.vy < 0) p.vy = 0
    }
    return null
  }
  if (wall.kind === "shelf" && wall.face !== "down") {
    const top = wall.top
    if ((p.vy < -120 || (p.launch || 0) > 0) && feet < top + 78) {
      if (feet > top) p.y -= feet - top
      if (p.vy > 0) p.vy = 0
      return null
    }
    if (prevY <= top + 18 && p.vy >= -80 && feet >= top - 14 && feet - top < 48) {
      p.y -= feet - top
      if (p.vy > 0) p.vy = 0
      return null
    }
    const centerY = p.y - PLAYER_H * 0.45
    if (centerY > top + 6 && centerY < wall.bottom) return "hurt"
    return null
  }
  if (wall.kind === "shelf") {
    const bottom = wall.bottom
    const centerY = p.y - PLAYER_H * 0.45
    if (p.vy <= 40 && head <= bottom + 12 && feet > bottom) {
      p.y += bottom + 2 - head
      if (p.vy < 0) p.vy = 0
      return null
    }
    if (centerY > wall.top + 4 && centerY < bottom - 8) return "hurt"
    return null
  }
  const top = wall.top
  const bottom = wall.bottom != null ? wall.bottom : top + 30
  const centerY = p.y - PLAYER_H * 0.45
  if (prevY <= top + 18 && p.vy >= -80 && feet >= top - 14 && feet - top < 40) {
    if (p.vy >= 0) {
      p.y -= feet - top
      p.vy = 0
    }
    return null
  }
  if (centerY > top + 6 && centerY < bottom) return "hurt"
  return null
}

function resolveShipWalls(p, level, prevY) {
  const head = p.y - 34
  const feet = p.y - 2
  for (const floor of level.floors || []) {
    const hit = applyShipWall(
      p,
      { kind: "deck", x: floor.x, w: floor.w, top: floor.top, bottom: floor.top + (floor.thick || 30) },
      prevY,
      head,
      feet,
    )
    if (hit === "hurt") return "hurt"
  }
  const walls = level.walls || []
  const right = p.x + PLAYER_W
  for (let i = p.wallI || 0; i < walls.length; i += 1) {
    const wall = walls[i]
    if (wall.x > right) break
    if (applyShipWall(p, wall, prevY, head, feet) === "hurt") return "hurt"
  }
  return null
}

function hitsSaw(box, obstacle) {
  const radius = obstacle.w * 0.42
  const cx = obstacle.x + obstacle.w / 2
  const base = obstacle.base || 0
  const cy = base - obstacle.h * 0.46
  const px = Math.max(box.left, Math.min(cx, box.right))
  const py = Math.max(box.top, Math.min(cy, box.bottom))
  const dx = cx - px
  const dy = cy - py
  return dx * dx + dy * dy < radius * radius
}

export function stepPlayer(p, level, t, dt, jumpPressed) {
  if (!p.alive) return { dead: false, jumped: false }
  const prevY = p.y
  p.x = level.xAt ? level.xAt(t) : t * level.speed
  if (p.scanX == null || p.x < p.scanX - 0.5) {
    p.obsI = 0
    p.wallI = 0
  }
  p.scanX = p.x
  const nearLeft = p.x - 24
  p.obsI = nearIndex(level.obstacles, p.obsI, nearLeft)
  p.wallI = nearIndex(level.walls, p.wallI, nearLeft)
  if (p.invuln > 0) p.invuln -= dt
  if (p.launch > 0) p.launch = Math.max(0, p.launch - dt)

  if (jumpPressed) p.buffer = 0.12
  else p.buffer = Math.max(0, p.buffer - dt)

  if (p.onGround) p.coyote = 0.1
  else p.coyote = Math.max(0, p.coyote - dt)

  if (p.onGround && !blockSupport(p, level)) p.onGround = false

  let jumped = false
  let launched = false
  let transformed = null
  for (const portal of level.portals || []) {
    const reach = portal.reach || 180
    const near = p.x + PLAYER_W > portal.x && p.x < portal.x + 64 && p.y < portal.top + 48 && p.y > portal.top - reach
    if (near && p.portalLock !== portal) {
      p.mode = portal.mode
      p.portalLock = portal
      transformed = portal.mode
      if (portal.mode === "cube") {
        p.vy = Math.max(80, p.vy)
        p.onGround = false
        p.spin = 0
      }
    } else if (!near && p.portalLock === portal) p.portalLock = null
  }
  if (p.mode === "ship") {
    const passed = (level.portals || []).filter((portal) => portal.mode === "cube" && p.x > portal.x - 8)
    const exit = passed[passed.length - 1]
    const nextShip = exit && (level.portals || []).find((portal) => portal.mode === "ship" && portal.x > exit.x)
    if (exit && (!nextShip || p.x < nextShip.x - 30)) {
      p.mode = "cube"
      p.portalLock = exit
      p.vy = Math.max(120, p.vy)
      p.onGround = false
      p.spin = 0
      if (p.y < exit.top - 86) p.y = exit.top - 86
      transformed = transformed || "cube"
    }
  }

  if (p.mode === "ship") {
    p.held = Boolean(jumpPressed)
    const lift = 3600
    if (jumpPressed) p.vy -= lift * dt
    else p.vy += lift * dt
    p.vy = Math.max(-680, Math.min(680, p.vy))
    p.y += p.vy * dt
    p.onGround = false
    p.spin = Math.max(-1, Math.min(1, p.vy / 680)) * 0.85
  } else {
  const edge = jumpPressed && !p.held
  p.held = Boolean(jumpPressed)
  const orb = edge ? (level.orbs || []).find((item) => {
    const cx = p.x + PLAYER_W * 0.5
    const cy = p.y - PLAYER_H * 0.45
    const dx = cx - item.x
    const dy = cy - item.y
    return dx * dx + dy * dy < 34 * 34
  }) : null
  if (orb) {
    const boost = orb.color === "pink" ? 1.28 : orb.color === "blue" ? 1.12 : 1
    p.vy = -level.jumpV * boost * (p.grav || 1)
    p.onGround = false
    p.coyote = 0
    p.buffer = 0
    p.airT = 0
    p.spin = 0
    jumped = true
  }
  const pad = (level.pads || []).find((item) => {
    const reach = item.reach || 0
    const yOk = reach ? p.y <= item.top + 16 && p.y >= item.top - reach : p.y >= item.top - 8 && p.y <= item.top + 16
    return p.x + PLAYER_W - 10 > item.x && p.x + 10 < item.x + item.w && yOk
  })
  if (pad && p.padLock !== pad && (pad.reach || p.onGround || (p.vy >= 0 && p.y >= pad.top - 4))) {
    p.vy = -level.jumpV * (pad.boost || 1.75)
    p.onGround = false
    p.coyote = 0
    p.buffer = 0
    p.airT = 0
    p.spin = 0
    p.padLock = pad
    p.launch = 0.7
    launched = true
  } else if (!pad) {
    p.padLock = null
  }
  if (!launched && p.buffer > 0 && (p.onGround || p.coyote > 0)) {
    p.vy = -level.jumpV
    p.onGround = false
    p.coyote = 0
    p.buffer = 0
    p.airT = 0
    p.spin = 0
    jumped = true
  }

  if (!p.onGround) {
    p.vy += level.gravity * (p.grav || 1) * dt
    p.y += p.vy * dt
    p.airT += dt
    p.spin = Math.min(1, p.airT / level.airTime) * Math.PI
  }
  }

  const touchSolid = (obstacle) => {
    if (!isSolid(obstacle.kind)) return null
    if (obstacle.x > p.x + PLAYER_W || obstacle.x + obstacle.w < p.x) return null
    const hit = collideBlock(p, obstacle, prevY)
    if (hit === "land") {
      if (p.mode === "ship" && jumpPressed && p.vy < 0) {
        p.y = Math.min(p.y, solidTop(obstacle))
      } else if (p.mode === "ship") {
        p.y = solidTop(obstacle)
        if (p.vy > 0) p.vy = 0
      } else {
        p.y = solidTop(obstacle)
        p.vy = 0
        p.onGround = true
        p.spin = 0
        p.airT = 0
      }
      return null
    }
    if (hit === "hurt" && p.invuln <= 0 && !p.immortal) {
      p.alive = false
      return { dead: true, jumped, launched, kind: "block" }
    }
    return null
  }
  for (const floor of level.floors || []) {
    const hit = touchSolid(floor)
    if (hit) return hit
  }
  const right = p.x + PLAYER_W
  for (let i = p.obsI || 0; i < level.obstacles.length; i += 1) {
    const obstacle = level.obstacles[i]
    if (obstacle.x > right) break
    const hit = touchSolid(obstacle)
    if (hit) return hit
  }

  if (p.mode === "ship" && resolveShipWalls(p, level, prevY) === "hurt" && p.invuln <= 0 && !p.immortal) {
    p.alive = false
    return { dead: true, jumped, launched, kind: "block" }
  }

  if (p.immortal && p.y > 180) {
    p.y = 20
    p.vy = 0
  }

  if (p.y > 130 && p.invuln <= 0 && !p.immortal) {
    p.alive = false
    return { dead: true, jumped, launched, kind: "void" }
  }

  if (p.invuln <= 0 && !p.immortal) {
    const box = hitbox(p)
    for (let i = p.obsI || 0; i < level.obstacles.length; i += 1) {
      const obstacle = level.obstacles[i]
      if (obstacle.x > box.right + 2) break
      if (isSolid(obstacle.kind)) continue
      if (obstacle.x + obstacle.w < box.left - 2) continue
      if (obstacle.kind === "cue" || obstacle.kind === "pad" || obstacle.kind === "orb") continue
      if (obstacle.kind === "saw") {
        if (hitsSaw(box, obstacle)) {
          p.alive = false
          return { dead: true, jumped, kind: "saw" }
        }
        continue
      }
      for (const tri of spikeTris(obstacle)) {
        if (rectHitsTri(box, tri)) {
          p.alive = false
          return { dead: true, jumped, kind: obstacle.kind }
        }
      }
    }
  }

  return { dead: false, jumped, launched, transformed }
}

export function spawnPlayer(level, time, options = {}) {
  const player = createPlayer(time, level.speed || 0)
  player.immortal = Boolean(options.immortal)
  if (level.xAt) player.x = level.xAt(time)
  const foot = player.x + 18
  const under = (level.floors || []).filter((floor) => foot >= floor.x && foot <= floor.x + floor.w)
  const fly = (level.flight || []).find((span) => time >= span.start - 0.04 && time <= span.end + 0.25)
  if (fly || options.asShip) {
    const span = fly || (level.flight || [])[0]
    player.mode = "ship"
    player.y = span ? flightY(level, Math.min(Math.max(time, span.start), span.end - 0.02)) : player.y
    player.vy = 0
    player.onGround = false
  } else if (under.length) {
    under.sort((a, b) => a.top - b.top)
    player.y = under[0].top
    player.onGround = true
    player.mode = "cube"
  }
  player.invuln = time === 0 ? 0 : 0.85
  return player
}

function replayAllowed(level, from) {
  if (from <= 0.02) return true
  if ((level.checkpoints || []).some((mark) => Math.abs(mark - from) <= 0.05)) return true
  return (level.flight || []).some((span) => Math.abs(span.start - from) <= 0.05)
}

export function replayRun(level, replay) {
  const from = Number(replay?.from) || 0
  const frames = replay?.frames
  if (!Number.isFinite(from) || from < 0) return null
  if (!replayAllowed(level, from)) return null
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 120000) return null
  const fly = (level.flight || []).find((span) => from >= span.start - 0.04 && from <= span.end + 0.25)
  const player = spawnPlayer(level, from, { immortal: replay.immortal === true, asShip: Boolean(fly) })
  let cursor = from
  const limit = (level.duration || 0) + 1
  for (const frame of frames) {
    if (!Array.isArray(frame)) return null
    const to = Number(frame[0])
    const held = frame[1] === 1
    if (!Number.isFinite(to) || to + 1e-4 < cursor || to > limit) return null
    const total = to - cursor
    if (total > 0) {
      const steps = Math.max(1, Math.ceil(total / (1 / 240)))
      const dt = total / steps
      let t = cursor
      for (let i = 0; i < steps; i += 1) {
        t = Math.min(to, t + dt)
        const result = stepPlayer(player, level, t, dt, held)
        if (result.dead) return { cleared: false, t, immortal: player.immortal === true }
      }
    }
    cursor = to
  }
  const finish = level.finishTime || level.duration || 0
  return {
    cleared: player.alive && cursor + 1e-3 >= finish,
    t: cursor,
    immortal: player.immortal === true,
  }
}

export function simulateRun(level, slop = 0) {
  const player = createPlayer(0, level.speed)
  const bot = createBot(level, slop)
  const dt = 1 / 240
  const end = level.finishTime
  for (let step = 1; step * dt <= end + 1e-4; step += 1) {
    const t = Math.min(end, step * dt)
    const pressed = bot.want(t, player)
    const result = stepPlayer(player, level, t, dt, pressed)
    if (result.dead) return { ok: false, t, x: player.x, kind: result.kind }
  }
  return { ok: player.alive, t: end, x: player.x, kind: null }
}

export async function simulateRunAsync(level, slop = 0) {
  const player = createPlayer(0, level.speed)
  const bot = createBot(level, slop)
  const dt = 1 / 240
  const end = level.finishTime
  let batch = 0
  for (let step = 1; step * dt <= end + 1e-4; step += 1) {
    const t = Math.min(end, step * dt)
    const pressed = bot.want(t, player)
    const result = stepPlayer(player, level, t, dt, pressed)
    if (result.dead) return { ok: false, t, x: player.x, kind: result.kind }
    batch += 1
    if (batch >= 1400) {
      batch = 0
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return { ok: player.alive, t: end, x: player.x, kind: null }
}

export function checkpointFor(level, time) {
  let chosen = 0
  for (const mark of level.checkpoints) {
    if (mark <= time - 0.35) chosen = mark
  }
  return chosen
}
