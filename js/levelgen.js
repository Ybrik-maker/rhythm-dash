import { SHIP_THRUST, simulateRun, simulateRunAsync } from "./physics.js"

const SPEED = 610
const JUMP_H = 154
const AIR_MIN = 0.3
const AIR_MAX = 0.48
const PLAYER_W = 40

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hsl(h, s, l) {
  const hue = ((h % 360) + 360) % 360
  const sat = s / 100
  const light = l / 100
  const a = sat * Math.min(light, 1 - light)
  const channel = (n) => {
    const k = (n + hue / 30) % 12
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function paletteFrom(features) {
  const hue = (300 * features.bassRatio + 188 * features.brightness + (features.seed % 90)) % 360
  return {
    skyTop: hsl(hue, 58, 9),
    skyBottom: hsl(hue + 24, 62, 4),
    accent: hsl(hue, 96, 64),
    accent2: hsl(hue + 38, 92, 58),
    ground: hsl(hue, 38, 13),
    groundEdge: hsl(hue, 95, 72),
    spike: hsl(hue + 6, 88, 56),
    spikeShade: hsl(hue - 16, 78, 38),
    block: hsl(hue + 46, 74, 54),
    blockShade: hsl(hue + 46, 60, 34),
    pad: "#ffe14a",
    player: "#f5f8fc",
    playerMark: hsl(hue, 95, 62),
    portal: hsl(hue + 52, 100, 68),
    deco: hsl(hue + 16, 80, 64),
    text: "#f7fbff",
  }
}

function motifFrom(features) {
  if (features.bassRatio > 0.48) return "shards"
  if (features.brightness > 0.42) return "rings"
  if (features.bpm > 140) return "beams"
  return "triangles"
}

function moodOf(features) {
  const bpm = Math.round(features.bpm)
  if (features.bassRatio > 0.46 && bpm >= 120) return "heavy and bassy"
  if (features.brightness > 0.48) return "bright and sharp"
  if (bpm >= 145) return "fast"
  if (bpm <= 96) return "slow and long"
  if (features.confidence < 0.35) return "loose, barely on the metronome"
  return "straight and rhythmic"
}

const SPECS = {
  spike: { w: 26, h: 34 },
  double: { w: 58, h: 32 },
  triple: { w: 88, h: 30 },
  quad: { w: 116, h: 28 },
  saw: { w: 34, h: 34 },
  block: { w: 64, h: 36 },
  platform: { w: 132, h: 32, bias: 36 },
  pillar: { w: 40, h: 58, bias: 18 },
}

function placeObstacle(kind, jumpAt, level) {
  const spec = SPECS[kind]
  const pace = level.paceAt ? level.paceAt(jumpAt) : level.speed
  const origin = level.xAt ? level.xAt(jumpAt) : jumpAt * level.speed
  const center = origin + pace * (level.airTime * 0.5) + PLAYER_W / 2 + (spec.bias || 0)
  return {
    kind,
    x: center - spec.w / 2,
    w: spec.w,
    h: spec.h,
    jumpAt,
  }
}

const DROP_KINDS = ["spike", "platform", "double", "saw", "spike", "pillar", "triple", "platform", "double", "spike"]

function keepSlot(section, slot, rng, confidence) {
  if (confidence < 0.28) return slot % 4 === 0
  if (section === "outro") return slot % 6 === 0
  if (section === "intro") return slot % 2 === 0
  if (section === "break") return slot % 2 === 0
  if (section === "rise") return rng() < 0.8
  if (section === "drop") return true
  return rng() < 0.55
}

function kindFor(section, slot, rng) {
  if (section === "drop") return DROP_KINDS[slot % DROP_KINDS.length]
  if (section === "rise") return ["spike", "double", "platform", "saw", "spike"][slot % 5]
  if (section === "break") return slot % 3 === 0 ? "platform" : "spike"
  if (section === "intro") return slot % 5 === 0 ? "block" : "spike"
  return "spike"
}

function buildClusters(peaks, airTime) {
  const clusters = []
  let current = null
  for (const peak of [...peaks].sort((a, b) => a.t - b.t)) {
    if (!current || peak.t - current.start >= airTime * 0.98) {
      current = { start: peak.t, peaks: [peak] }
      clusters.push(current)
    } else current.peaks.push(peak)
  }
  return clusters
}

function rhythmKind(count) {
  if (count >= 4) return "quad"
  if (count >= 3) return "triple"
  if (count >= 2) return "double"
  return "spike"
}

function insideHold(features, time) {
  return (features.plateaus || []).some((item) => {
    const mid = (item.start + item.end) / 2
    return features.sectionAt(mid) !== "drop" && time > item.start + 0.2 && time < item.end - 0.2
  })
}

function buildTerrain(features, level) {
  const { speed, airTime, jumpV, gravity, beatDur, duration } = level
  const xAt = level.xAt || ((time) => time * speed)
  const timeAt = level.timeAt || ((x) => x / speed)
  const paceAt = level.paceAt || (() => speed)
  const beats = level.beats.length ? level.beats : [0]
  const stepH = 58
  const floors = []
  const pads = []
  const cues = []
  const portals = []
  const flight = []
  const shipObstacles = []
  const walls = []
  let lane = 0
  let cursor = 0
  const endX = xAt(duration) + 80

  const topOf = (value) => -value * stepH

  function pushFloor(x, width, atLane, hot = false) {
    if (width < 12 || x > endX) return
    const top = topOf(atLane)
    const prev = floors[floors.length - 1]
    if (prev && Math.abs(prev.top - top) < 1 && x <= prev.x + prev.w + 4 && prev.hot === hot) {
      prev.w = Math.max(prev.w, x + width - prev.x)
      return
    }
    floors.push({ kind: "floor", x, w: Math.min(width, endX - x), top, h: 30, thick: 30, hot })
  }

  function launchTimes(boost, lanesUp) {
    const height = lanesUp * stepH
    const vy = jumpV * boost
    const disc = vy * vy - 2 * gravity * height
    if (disc <= 0) return null
    const root = Math.sqrt(disc)
    return { up: (vy - root) / gravity, down: (vy + root) / gravity }
  }

  function nearestBeat(time) {
    return beats.reduce((best, beat) => (Math.abs(beat - time) < Math.abs(best - time) ? beat : best), beats[0])
  }

  function runWithGap(fromX, toX, atLane, wantGap) {
    const pace = paceAt(timeAt(fromX))
    if (toX - fromX < pace * 0.4) {
      pushFloor(fromX, toX - fromX, atLane)
      return toX
    }
    if (!wantGap || toX - fromX < pace * 2.4) {
      pushFloor(fromX, toX - fromX, atLane)
      return toX
    }
    const beat = nearestBeat(timeAt((fromX + toX) / 2))
    const jumpX = xAt(beat)
    const gap = pace * airTime * 0.52
    if (jumpX < fromX + pace * 0.45 || jumpX + gap > toX - pace * 0.45) {
      pushFloor(fromX, toX - fromX, atLane)
      return toX
    }
    pushFloor(fromX, jumpX + 20 - fromX, atLane)
    cues.push(beat)
    const land = jumpX + 20 + gap
    pushFloor(land, toX - land, atLane)
    return toX
  }

  pushFloor(0, Math.max(90, speed * 0.7), 0)
  cursor = speed * 0.7

  for (const section of features.sections) {
    const pace = paceAt(section.start)
    const x0 = Math.max(cursor, xAt(section.start))
    const x1 = Math.max(x0, Math.min(endX, xAt(section.end)))
    if (x1 - cursor < 30 && section.type !== "drop") continue

    if (section.type === "rise" && x1 - x0 > pace * 1.1) {
      const steps = Math.max(4, Math.min(8, Math.round((x1 - x0) / (pace * beatDur * 0.9))))
      const stepW = (x1 - x0) / steps
      for (let i = 0; i < steps; i += 1) {
        lane = Math.min(6, lane + (i % 2 === 0 || lane < 2 ? 1 : 0))
        pushFloor(x0 + i * stepW, stepW + 22, lane)
      }
      cursor = x1
    } else if (section.type === "drop") {
      const beat = nearestBeat(section.start + beatDur * 0.15)
      const padW = 58
      let padX = Math.max(cursor, xAt(beat))
      const previousPortal = portals[portals.length - 1]
      const portalGap = Math.max(1600, pace * 2.6)
      if (previousPortal && previousPortal.mode === "cube" && padX < previousPortal.x + portalGap) {
        padX = previousPortal.x + portalGap
      }
      pushFloor(cursor, padX + padW + 6 - cursor, lane)
      const energy = features.energyAt(section.start)
      const up = energy > 0.72 ? 3 : 2
      const boost = up >= 3 ? 1.92 : 1.72
      const times = launchTimes(boost, up)
      if (times && lane + up <= 7) {
        const from = lane
        pads.push({ kind: "pad", x: padX, w: padW, top: topOf(from), boost, reach: 96 })
        const launchT = timeAt(padX + padW)
        const lipX = xAt(launchT + times.up + 0.18)
        lane = Math.min(7, from + up)
        const floorStart = Math.max(padX + padW + 28, lipX)
        const floorEnd = Math.max(floorStart + pace * 1.7, x1)
        if (floorStart > padX + padW + 6) pushFloor(padX + padW + 6, floorStart - (padX + padW + 6), from)
        pushFloor(floorStart, floorEnd - floorStart, lane, true)
        const portalX = floorStart + 36
        const exitX = floorEnd - 80
        const floorTop = topOf(lane)
        const mouthY = floorTop - 96
        portals.push({ x: portalX, top: floorTop, mode: "ship", reach: 420 })
        portals.push({ x: exitX, top: floorTop, mode: "cube", reach: 640 })
        const startT = timeAt(portalX)
        const endT = timeAt(exitX)
        const ceilBase = floorTop - 268
        const pillars = []
        const route = []
        const shells = []
        const waveStart = startT + 0.4
        const waveEnd = Math.min(endT - 0.5, Math.max(waveStart + 0.7, endT - 0.7))
        const step = Math.max(0.55, beatDur * 1.15)
        const marks = []
        for (let t = waveStart; t < waveEnd - 0.15; t += step) marks.push(t)
        if (!marks.length || waveEnd - marks[marks.length - 1] > 0.2) marks.push(waveEnd)
        const energies = marks.map((t) => features.energyAt(Math.min(t, features.duration - 0.05)))
        const smooth = energies.map((value, index) => {
          const prev = energies[Math.max(0, index - 1)]
          const next = energies[Math.min(energies.length - 1, index + 1)]
          return (prev + value + next) / 3
        })
        let lowE = smooth[0] ?? 0.5
        let highE = lowE
        for (const value of smooth) {
          if (value < lowE) lowE = value
          if (value > highE) highE = value
        }
        const spanE = Math.max(0.04, highE - lowE)
        const yFromEnergy = (value) => {
          const local = Math.max(0, Math.min(1, (value - lowE) / spanE))
          const absolute = Math.max(0, Math.min(1, (value - 0.32) / 0.58))
          const u = spanE < 0.12 ? absolute * 0.7 + 0.3 : local
          return floorTop - 165 - u * 210
        }
        const snapY = (value) => {
          const grid = 54
          const snapped = Math.round(value / grid) * grid
          return Math.max(floorTop - 390, Math.min(floorTop - 140, snapped))
        }
        const pushAxis = (t0, t1, y0, y1) => {
          const span = t1 - t0
          if (span < 0.08) return y0
          const dy = y1 - y0
          if (Math.abs(dy) < 40) {
            route.push({ t0, t1, y0, y1: y0, narrow: false, axis: "flat", linear: true, mode: "flat" })
            return y0
          }
          const climb = Math.min(span * 0.48, Math.max(0.08, Math.abs(dy) / SHIP_THRUST))
          const maxDy = Math.sign(dy) * climb * SHIP_THRUST * 0.92
          const yEnd = Math.abs(dy) > Math.abs(maxDy) ? y0 + maxDy : y1
          const rise = Math.max(0.08, Math.min(climb, Math.abs(yEnd - y0) / SHIP_THRUST))
          if (span - rise < 0.14) {
            route.push({
              t0,
              t1,
              y0,
              y1: yEnd,
              narrow: false,
              axis: "steep",
              linear: true,
              mode: yEnd < y0 ? "up" : "down",
            })
            return yEnd
          }
          route.push({
            t0,
            t1: t0 + rise,
            y0,
            y1: yEnd,
            narrow: false,
            axis: "steep",
            linear: true,
            mode: yEnd < y0 ? "up" : "down",
          })
          route.push({
            t0: t0 + rise,
            t1,
            y0: yEnd,
            y1: yEnd,
            narrow: false,
            axis: "flat",
            linear: true,
            mode: "flat",
          })
          return yEnd
        }
        const enterT = Math.min(waveStart - 0.16, startT + 0.05)
        let laneY = mouthY
        if (waveStart - enterT > 0.12) laneY = pushAxis(enterT, waveStart, mouthY, mouthY)
        if (route.length) route[0].mouth = true
        for (let i = 0; i < marks.length - 1; i += 1) {
          laneY = pushAxis(marks[i], marks[i + 1], laneY, snapY(yFromEnergy(smooth[i + 1] ?? smooth[i])))
        }
        if (route.length < 2 && waveEnd > waveStart + 0.35) {
          pushAxis(waveStart, waveEnd, laneY, snapY(yFromEnergy(features.energyAt((waveStart + waveEnd) / 2))))
        }
        let pinchAt = -1
        if (route.length >= 3) {
          const want = route[0].t0 + (route[route.length - 1].t1 - route[0].t0) * 0.42
          let best = Infinity
          route.forEach((seg, index) => {
            if (seg.axis !== "flat" || seg.t1 - seg.t0 < 0.28) return
            const dist = Math.abs((seg.t0 + seg.t1) / 2 - want)
            if (dist < best) {
              best = dist
              pinchAt = index
            }
          })
        }
        if (pinchAt >= 0) {
          const hold = route[pinchAt].y0
          route[pinchAt].y0 = hold
          route[pinchAt].y1 = hold
          route[pinchAt].pinch = true
          route[pinchAt].narrow = true
          if (route[pinchAt + 1]) {
            route[pinchAt + 1].y0 = hold
            if (route[pinchAt + 1].axis === "flat") route[pinchAt + 1].y1 = hold
          }
        }
        const last = route[route.length - 1]
        if (last) {
          const drop = Math.abs(mouthY - last.y1)
          const dive = Math.min(0.7, Math.max(0.16, drop / SHIP_THRUST))
          const funnelEnd = Math.min(endT - 0.02, last.t1 + dive)
          if (funnelEnd - last.t1 > 0.12) {
            route.push({
              t0: last.t1,
              t1: funnelEnd,
              y0: last.y1,
              y1: mouthY,
              narrow: false,
              axis: "steep",
              linear: true,
              funnel: true,
              mode: "down",
            })
          }
        }
        const mixOf = (u) => Math.max(0, Math.min(1, u))
        for (const seg of route) {
          const flat = seg.axis === "flat" || (!seg.funnel && !seg.pinch && Math.abs(seg.y1 - seg.y0) < 28)
          const steep = seg.axis === "steep"
          const slices = seg.funnel ? 6 : seg.pinch || flat ? 1 : steep ? 3 : 4
          const mix = mixOf
          for (let i = 0; i < slices; i += 1) {
            const u0 = i / slices
            const u1 = (i + 1) / slices
            const yA = seg.y0 + (seg.y1 - seg.y0) * mix(u0)
            const yB = seg.y0 + (seg.y1 - seg.y0) * mix(u1)
            const yHigh = Math.min(yA, yB)
            const yLow = Math.max(yA, yB)
            const along = seg.funnel ? (u0 + u1) / 2 : 0
            const up = seg.mouth ? 112 : seg.funnel ? 240 + (112 - 240) * along : seg.pinch ? 168 : seg.narrow ? 170 : 250
            const down = seg.mouth ? 72 : seg.funnel ? 120 : seg.pinch ? 62 : seg.narrow ? 100 : 150
            const ceil = yHigh - up
            const deck = seg.funnel || seg.mouth ? floorTop : Math.min(yLow + down, floorTop - 24)
            const x0 = xAt(seg.t0 + (seg.t1 - seg.t0) * u0)
            const x1 = xAt(seg.t0 + (seg.t1 - seg.t0) * u1)
            if (x1 - x0 < 24) continue
            shells.push({ x: x0, w: x1 - x0, ceil, floor: deck, narrow: seg.pinch || seg.narrow || flat })
            walls.push({ kind: "ceiling", x: x0, w: x1 - x0, lip: ceil })
            if (!seg.funnel) walls.push({ kind: "shelf", face: "up", x: x0, w: x1 - x0, top: deck, bottom: deck + 90 })
            if (seg.funnel || steep || seg.mouth) {
              continue
            }
            const tight = seg.narrow || seg.pinch
            const spikeH = tight ? 14 : 16
            for (let x = x0 + 28; x < x1 - 28; x += tight ? 64 : 84) {
              shipObstacles.push({
                kind: "spike",
                x,
                w: 22,
                h: spikeH,
                base: deck,
                jumpAt: -999,
                flip: false,
                glow: true,
              })
            }
            for (let x = x0 + 48; x < x1 - 48; x += tight ? 130 : 150) {
              shipObstacles.push({
                kind: "spike",
                x,
                w: 22,
                h: spikeH,
                base: ceil,
                jumpAt: -999,
                flip: true,
                glow: true,
              })
            }
          }
        }
        flight.push({
          start: startT,
          end: endT,
          center: floorTop - 240,
          amp: 40,
          omega: Math.PI / beatDur,
          shellTop: ceilBase,
          floorTop,
          shellFrom: portalX + 200,
          shellTo: exitX - 280,
          pillars,
          route,
          shells,
        })
        cursor = floorEnd
      } else {
        cursor = runWithGap(cursor, x1, lane, true)
      }
    } else if (section.type === "break" && lane > 0 && x1 - x0 > pace * 0.8) {
      const steps = Math.min(lane, Math.max(2, Math.round((x1 - x0) / (pace * beatDur))))
      const stepW = (x1 - Math.max(cursor, x0)) / steps
      const start = Math.max(cursor, x0)
      for (let i = 0; i < steps; i += 1) {
        lane = Math.max(0, lane - 1)
        pushFloor(start + i * stepW, stepW + 20, lane)
      }
      cursor = start + steps * stepW
    } else {
      cursor = runWithGap(Math.min(cursor, x0), x1, lane, section.type !== "outro")
    }
  }

  if (cursor < endX) pushFloor(cursor, endX - cursor, lane)
  return { floors, pads, cues, portals, flight, shipObstacles, walls, stepH }
}

function buildCheckpoints(obstacles, floors, duration, xAt) {
  const marks = [0]
  const onFloor = (time) => {
    const x = xAt(time) + 16
    return floors.some((floor) => x >= floor.x + 6 && x <= floor.x + floor.w - 6)
  }
  const clear = (time) => {
    const x = xAt(time)
    return onFloor(time) && !obstacles.some((obstacle) => obstacle.kind !== "cue" && obstacle.kind !== "floor" && x + 36 > obstacle.x - 16 && x < obstacle.x + obstacle.w + 16)
  }
  for (let time = 8; time < duration - 5; time += 8) {
    let chosen = null
    for (let delta = 0; delta <= 2.5; delta += 0.05) {
      if (clear(time + delta)) {
        chosen = time + delta
        break
      }
    }
    if (chosen != null && chosen < duration - 4) marks.push(Number(chosen.toFixed(3)))
  }
  return marks
}

function scenery(features, level, rng) {
  const decorations = []
  const groundDeco = []
  const span = level.xAt ? level.xAt(level.duration) : level.duration * level.speed
  const xOf = level.xAt || ((time) => time * level.speed)
  const tOf = level.timeAt || ((x) => x / level.speed)
  const beat = level.beatDur || 0.47
  const near = ["orb", "saw", "beams", "shards", "rings"]
  for (let time = 0.3; time < level.duration; time += beat * 0.25) {
    const section = features.sectionAt(time)
    const drop = section === "drop"
    const x = xOf(time)
    const slot = Math.round(time / (beat * 0.25))
    const off = slot % 4 !== 0
    decorations.push({
      kind: off ? near[slot % near.length] : drop ? "saw" : level.motif,
      x,
      y: off ? -64 - (slot % 3) * 28 : -140 - (drop ? 70 : 24),
      size: off ? 14 + (slot % 3) * 6 : drop ? 30 : 22,
      rot: time,
      parallax: off ? 0.94 : 0.4,
      alpha: off ? 0.82 : drop ? 0.6 : 0.36,
    })
    if (!off && (drop || section === "rise")) {
      decorations.push({
        kind: level.motif,
        x: x + 24,
        y: -210 - (drop ? 70 : 20),
        size: drop ? 40 : 26,
        rot: time * 0.5,
        parallax: 0.2,
        alpha: drop ? 0.4 : 0.22,
      })
    }
  }
  for (let x = 30; x < span; x += 90) {
    const time = tOf(x)
    const drop = features.sectionAt(time) === "drop"
    decorations.push({
      kind: drop && rng() < 0.5 ? "saw" : level.motif,
      x,
      y: -260 - rng() * 180,
      size: 20 + rng() * (drop ? 64 : 36),
      rot: rng() * Math.PI,
      parallax: 0.12 + rng() * 0.2,
      alpha: drop ? 0.34 : 0.16,
    })
  }
  const width = 36
  for (let x = 0; x < span; x += width) {
    const time = tOf(x)
    const energy = features.energyAt(time)
    const drop = features.sectionAt(time) === "drop"
    groundDeco.push({
      x,
      w: width - 4,
      h: 16 + Math.round(energy * (drop ? 54 : 28) + ((x / width) % 5) * 10),
    })
  }
  return { decorations, groundDeco }
}

function insights(features, level) {
  const bpm = Math.round(features.bpm)
  const doubles = level.obstacles.filter((obstacle) => obstacle.kind === "double").length
  const lines = [
    `Tempo is about ${bpm} BPM, so the jump sits on the beat.`,
    `The mood is ${level.mood}, and that sets the colors and how dense the spikes are.`,
  ]
  lines.push("The waveform decides where a spike, saw, or wall goes. The side of a wall or platform kills.")
  lines.push("The drop has a ship portal. The tunnel runs in straight stretches by loudness. Hold = up, release = down, both equally fast. At the end you are a cube again.")
  lines.push("A blue orb is an extra jump: tap it as the cube and you go higher than a normal jump. Pink is stronger, yellow is the basic one.")
  if (features.confidence < 0.35) {
    lines[0] = "The rhythm is not a strict metronome, so the track is thinner and has more straight parts."
  }
  return lines
}

function removeFatal(level, result) {
  let nearest = -1
  let best = Infinity
  level.obstacles.forEach((obstacle, index) => {
    if (obstacle.kind === "cue") return
    const along = obstacle.jumpAt >= 0 ? Math.abs(obstacle.jumpAt - result.t) : Math.abs(obstacle.x + obstacle.w * 0.5 - result.x) / (level.speed || 610)
    if (along < best) {
      best = along
      nearest = index
    }
  })
  if (nearest >= 0) level.obstacles.splice(nearest, 1)
}

const VERIFY_SLOPS = [0, -0.05, 0.05]

function verify(level) {
  let stripped = 0
  const clean = new Set()
  for (const slop of VERIFY_SLOPS) {
    for (let pass = 0; pass < 14; pass += 1) {
      const result = simulateRun(level, slop)
      if (result.ok) {
        clean.add(slop)
        break
      }
      stripped += 1
      removeFatal(level, result)
      clean.clear()
      if (!level.obstacles.length) break
    }
  }
  let ok = true
  for (const slop of VERIFY_SLOPS) {
    if (clean.has(slop)) continue
    if (!simulateRun(level, slop).ok) ok = false
  }
  return { ok, stripped }
}

async function verifyLive(level, onStatus) {
  let stripped = 0
  let step = 0
  const clean = new Set()
  const tick = () => {
    step += 1
    onStatus?.(0.9 + 0.08 * Math.min(1, step / 18), "Checking that the track can be finished…")
  }
  for (const slop of VERIFY_SLOPS) {
    for (let pass = 0; pass < 14; pass += 1) {
      tick()
      const result = await simulateRunAsync(level, slop)
      if (result.ok) {
        clean.add(slop)
        break
      }
      stripped += 1
      removeFatal(level, result)
      clean.clear()
      if (!level.obstacles.length) break
    }
  }
  let ok = true
  for (const slop of VERIFY_SLOPS) {
    if (clean.has(slop)) continue
    tick()
    if (!(await simulateRunAsync(level, slop)).ok) ok = false
  }
  return { ok, stripped }
}

function sealLevel(level, features) {
  level.checkpoints = buildCheckpoints(level.obstacles, level.floors, features.duration, level.xAt)
  for (const span of level.flight || []) level.checkpoints.push(Number(span.start.toFixed(3)))
  level.checkpoints.sort((a, b) => a - b)
  level.insights = insights(features, level)
  level.doubles = level.obstacles.filter((obstacle) => obstacle.kind === "double").length
  return level
}

function composeLevel(features, songName = "Song") {
  const rng = mulberry32(features.seed || 1)
  const bpm = clamp(features.bpm || 120, 78, 176)
  const beatDur = 60 / bpm
  const airTime = clamp(beatDur, AIR_MIN, AIR_MAX)
  const jumpV = (2 * JUMP_H) / airTime
  const gravity = (4 * JUMP_H) / (airTime * airTime)
  const minGap = airTime * 0.98
  const stepBeats = Math.max(1, Math.ceil((minGap - 1e-3) / beatDur))
  const endBuffer = features.duration < 20 ? Math.max(2.5, features.duration * 0.24) : Math.min(6.2, Math.max(3.6, features.duration * 0.09))
  const lastJump = features.duration - endBuffer

  let phase = features.phase || 0
  phase = ((phase % beatDur) + beatDur) % beatDur
  const beats = []
  for (let time = phase; time < features.duration; time += beatDur) beats.push(time)

  const paceAt = (time) => {
    for (const section of features.sections || []) {
      if (time >= section.start && time < section.end) return section.type === "drop" ? SPEED * 1.48 : SPEED
    }
    return SPEED
  }
  const cuts = [0]
  for (const section of features.sections || []) {
    if (section.start > 0 && section.start < features.duration) cuts.push(section.start)
  }
  cuts.push(Math.max(features.duration, 0.001))
  cuts.sort((a, b) => a - b)
  const segT = []
  for (const mark of cuts) {
    if (!segT.length || mark - segT[segT.length - 1] > 1e-4) segT.push(mark)
  }
  const segPace = []
  const segX = [0]
  for (let i = 0; i < segT.length - 1; i += 1) {
    const pace = paceAt(segT[i] + 1e-4)
    segPace.push(pace)
    segX.push(segX[i] + (segT[i + 1] - segT[i]) * pace)
  }
  const xAt = (time) => {
    const t = Math.max(0, time)
    const last = segT.length - 1
    if (t >= segT[last]) return segX[last] + (t - segT[last]) * segPace[last - 1]
    let lo = 0
    let hi = last - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (segT[mid] <= t) lo = mid
      else hi = mid - 1
    }
    return segX[lo] + (t - segT[lo]) * segPace[lo]
  }
  const timeAt = (x) => {
    let lo = 0
    let hi = features.duration + 0.5
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2
      if (xAt(mid) < x) lo = mid
      else hi = mid
    }
    return lo
  }

  const level = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    songName,
    title: songName,
    mood: moodOf(features),
    bpm,
    confidence: features.confidence || 0,
    duration: features.duration,
    speed: SPEED,
    paceAt,
    xAt,
    timeAt,
    dropMul: 1.48,
    airTime,
    jumpV,
    gravity,
    jumpH: JUMP_H,
    beatDur,
    phase,
    palette: paletteFrom(features),
    motif: motifFrom(features),
    sections: features.sections,
    waveform: features.waveform,
    energyAt: features.energyAt,
    finishTime: Math.max(1, features.duration - 0.08),
    clearAt: lastJump,
    obstacles: [],
    floors: [],
    pads: [],
    gates: [],
    decorations: [],
    groundDeco: [],
    checkpoints: [0],
    beats,
  }

  const terrain = buildTerrain(features, level)
  level.floors = terrain.floors
  level.pads = terrain.pads
  level.gates = []
  level.portals = terrain.portals
  level.flight = terrain.flight
  level.walls = terrain.walls
  level.walls.sort((a, b) => a.x - b.x)
  level.orbs = []
  for (const cue of terrain.cues) {
    level.obstacles.push({ kind: "cue", x: level.xAt(cue), w: 0, h: 0, jumpAt: cue, base: 0 })
  }
  for (const section of features.sections) {
    if (section.type !== "rise" && section.type !== "break") continue
    const time = section.start + Math.min(2.2, (section.end - section.start) * 0.42)
    if (time < 1.4 || time > lastJump) continue
    const x = level.xAt(time)
    const floor = level.floors.find((item) => x >= item.x + 20 && x <= item.x + item.w - 20)
    if (!floor) continue
    if (level.pads.some((pad) => Math.abs(pad.x - x) < 200)) continue
    level.pads.push({ kind: "pad", x, w: 52, top: floor.top, boost: 1.16, color: "pink", t: time })
  }

  let lastJumpAt = -999
  const peaks = features.peaks || []
  for (let index = 0; index < beats.length; index += stepBeats) {
    const time = beats[index]
    if (time < 1.05 || time > lastJump) continue
    const section = features.sectionAt(time)
    if (section === "outro" || section === "drop") continue
    if (level.portals.some((portal) => portal.mode === "cube" && time > level.timeAt(portal.x) && time < level.timeAt(portal.x) + 0.7)) continue
    if (level.pads.some((pad) => Number.isFinite(pad.t) && time > pad.t && time < pad.t + 0.6)) continue
    const nearby = peaks.filter((peak) => peak.t >= time - 0.05 && peak.t < time + beatDur * 0.92)
    const count = nearby.length
    const energy = features.energyAt(time)
    if (count === 0 && energy < 0.12 && section === "outro") continue
    if (section === "drop") {
      const drop = features.sections.find((item) => item.type === "drop" && time >= item.start && time < item.end)
      if (drop && time > drop.end - 0.55) continue
    }

    const kindBase = insideHold(features, time) ? "platform" : rhythmKind(Math.max(count, 1))
    const kind = kindBase === "spike" && index % 3 === 0 ? "double" : kindBase
    const timed = kind === "spike" || kind === "double" || kind === "triple" || kind === "quad" || kind === "saw"
    const earliest = lastJumpAt < 0 ? time : lastJumpAt + level.airTime + 0.2
    if (lastJumpAt > 0 && time < earliest - beatDur * 0.55) continue
    const jumpTime = timed ? Math.max(time, earliest) : time
    if (jumpTime > lastJump) continue
    if (lastJumpAt > 0 && jumpTime - lastJumpAt < minGap - 0.02) continue
    const obstacle = placeObstacle(kind, jumpTime, level)
    if (obstacle.x < 60) continue
    let floor = level.floors.find((item) => obstacle.x + obstacle.w * 0.5 >= item.x && obstacle.x + obstacle.w * 0.5 <= item.x + item.w)
    if (!floor) {
      const mid = obstacle.x + obstacle.w * 0.5
      floor = level.floors.find((item) => mid >= item.x - 70 && mid <= item.x + item.w + 70)
      if (floor) {
        const clamped = Math.min(floor.x + floor.w - obstacle.w * 0.5 - 6, Math.max(floor.x + obstacle.w * 0.5 + 6, mid))
        obstacle.x = clamped - obstacle.w * 0.5
      }
    }
    if (!floor) continue
    if (level.pads.some((pad) => obstacle.x < pad.x + pad.w + 30 && obstacle.x + obstacle.w > pad.x - 30)) continue
    obstacle.base = floor.top
    if (kind === "block" || kind === "platform" || kind === "pillar") obstacle.top = floor.top - obstacle.h
    level.obstacles.push(obstacle)
    lastJumpAt = jumpTime
  }

  const cubeJumps = level.obstacles.filter((item) => item.jumpAt >= 0 && item.kind !== "cue").sort((a, b) => a.jumpAt - b.jumpAt)
  for (let i = 0; i < cubeJumps.length - 1; i += 1) {
    const gap = cubeJumps[i + 1].jumpAt - cubeJumps[i].jumpAt
    if (gap < level.airTime * 2.2) continue
    const jumpTime = cubeJumps[i].jumpAt + level.airTime + 0.2
    if (jumpTime > cubeJumps[i + 1].jumpAt - level.airTime + 0.04) continue
    const section = features.sectionAt(jumpTime)
    if (section === "drop" || section === "outro") continue
    if (level.flight.some((span) => jumpTime >= span.start - 0.15 && jumpTime < span.end + 0.15)) continue
    const extra = placeObstacle("spike", jumpTime, level)
    if (extra.x < 60) continue
    const floor = level.floors.find((item) => extra.x + extra.w * 0.5 >= item.x && extra.x + extra.w * 0.5 <= item.x + item.w)
    if (!floor) continue
    if (level.pads.some((pad) => extra.x < pad.x + pad.w + 30 && extra.x + extra.w > pad.x - 30)) continue
    extra.base = floor.top
    level.obstacles.push(extra)
    cubeJumps.splice(i + 1, 0, extra)
  }

  if (level.obstacles.length < 3 && features.duration > 10) {
    for (let time = Math.max(1.4, phase); time < lastJump; time += beatDur * Math.max(2, stepBeats)) {
      level.obstacles.push(placeObstacle("spike", time, level))
    }
  }

  for (const spike of terrain.shipObstacles) level.obstacles.push(spike)
  for (let index = 0; index < beats.length; index += 2) {
    const time = beats[index]
    if (time < 1.3 || time > lastJump - 0.4) continue
    const section = features.sectionAt(time)
    if (section === "drop" || section === "outro") continue
    if (level.flight.some((span) => time >= span.start - 0.2 && time < span.end + 0.2)) continue
    const x = level.xAt(time) + 90
    const floor = level.floors.find((item) => x >= item.x + 10 && x <= item.x + item.w - 10)
    if (!floor) continue
    if (level.obstacles.some((item) => item.kind !== "cue" && Math.abs(item.x + item.w * 0.5 - x) < 36 && Math.abs((item.base || 0) - floor.top) < 80)) continue
    const color = index % 6 === 0 ? "pink" : index % 4 === 0 ? "blue" : "yellow"
    level.orbs.push({ x, y: floor.top - (color === "pink" ? 126 : 96), color })
  }

  level.obstacles.sort((a, b) => a.x - b.x)
  const scene = scenery(features, level, rng)
  level.decorations = scene.decorations
  level.groundDeco = scene.groundDeco
  return level
}

export function attachMotion(level) {
  const speed = level.speed || SPEED
  const dropMul = level.dropMul || 1.48
  const duration = Math.max(level.duration || 0.001, 0.001)
  const paceAt = (time) => {
    for (const section of level.sections || []) {
      if (time >= section.start && time < section.end) return section.type === "drop" ? speed * dropMul : speed
    }
    return speed
  }
  const cuts = [0]
  for (const section of level.sections || []) {
    if (section.start > 0 && section.start < duration) cuts.push(section.start)
  }
  cuts.push(duration)
  cuts.sort((a, b) => a - b)
  const segT = []
  for (const mark of cuts) {
    if (!segT.length || mark - segT[segT.length - 1] > 1e-4) segT.push(mark)
  }
  const segPace = []
  const segX = [0]
  for (let i = 0; i < segT.length - 1; i += 1) {
    segPace.push(paceAt(segT[i] + 1e-4))
    segX.push(segX[i] + (segT[i + 1] - segT[i]) * segPace[i])
  }
  const xAt = (time) => {
    const t = Math.max(0, time)
    const last = segT.length - 1
    if (!segPace.length) return t * speed
    if (t >= segT[last]) return segX[last] + (t - segT[last]) * segPace[last - 1]
    let lo = 0
    let hi = last - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (segT[mid] <= t) lo = mid
      else hi = mid - 1
    }
    return segX[lo] + (t - segT[lo]) * segPace[lo]
  }
  const timeAt = (x) => {
    let lo = 0
    let hi = duration + 0.5
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2
      if (xAt(mid) < x) lo = mid
      else hi = mid
    }
    return lo
  }
  level.paceAt = paceAt
  level.xAt = xAt
  level.timeAt = timeAt
  return level
}

export function generateLevel(features, songName = "Song") {
  const level = composeLevel(features, songName)
  level.sim = verify(level)
  return sealLevel(level, features)
}

export async function generateLevelLive(features, songName = "Song", onStatus) {
  onStatus?.(0.9, "Placing spikes so they can be jumped…")
  await new Promise((resolve) => setTimeout(resolve, 0))
  const level = composeLevel(features, songName)
  level.sim = await verifyLive(level, onStatus)
  return sealLevel(level, features)
}
