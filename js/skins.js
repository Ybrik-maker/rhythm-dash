export const SKINS = [
  { id: "slab", name: "Slab", shape: "slab", cube: "#f7fbff", mark: "#2ee6ff", ship: "#f7fbff", flame: "#49e4ff", need: null, hint: "From the start" },
  { id: "diamond", name: "Diamond", shape: "diamond", cube: "#f7fbff", mark: "#ff4d8d", ship: "#f7fbff", flame: "#ff4d8d", need: { clears: 1 }, hint: "Clear 1 level" },
  { id: "dart", name: "Arrow", shape: "dart", cube: "#f7fbff", mark: "#ffe14a", ship: "#f7fbff", flame: "#ffe14a", need: { created: 5 }, hint: "Create 5 levels" },
  { id: "disc", name: "Disc", shape: "disc", cube: "#f7fbff", mark: "#49e4ff", ship: "#f7fbff", flame: "#49e4ff", need: { clears: 10 }, hint: "Clear 10 levels" },
  { id: "hex", name: "Hex", shape: "hex", cube: "#f7fbff", mark: "#c6ff4a", ship: "#f7fbff", flame: "#c6ff4a", need: { created: 15 }, hint: "Create 15 levels" },
  { id: "star", name: "Star", shape: "star", cube: "#f7fbff", mark: "#ff8a3d", ship: "#f7fbff", flame: "#ff8a3d", need: { clears: 25 }, hint: "Clear 25 levels" },
]

export function skinById(id) {
  return SKINS.find((skin) => skin.id === id) || SKINS[0]
}

export function skinUnlocked(skin, stats) {
  if (!skin.need) return true
  const created = stats?.created || 0
  const clears = stats?.clears || 0
  if (skin.need.clears != null) return clears >= skin.need.clears
  if (skin.need.created != null) return created >= skin.need.created
  return false
}

function poly(ctx, points) {
  ctx.beginPath()
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point[0], point[1])
    else ctx.lineTo(point[0], point[1])
  })
  ctx.closePath()
  ctx.fill()
}

function ring(ctx, sides, radius, spin) {
  const points = []
  for (let i = 0; i < sides; i += 1) {
    const angle = spin + (Math.PI * 2 * i) / sides
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  poly(ctx, points)
}

function star(ctx, outer, inner, spin) {
  const points = []
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = spin + (Math.PI * 2 * i) / 10
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  poly(ctx, points)
}

function drawCube(ctx, skin) {
  ctx.fillStyle = skin.cube
  if (skin.shape === "diamond") {
    ring(ctx, 4, 20, -Math.PI / 2)
    ctx.fillStyle = skin.mark
    ring(ctx, 4, 8, -Math.PI / 2)
    return
  }
  if (skin.shape === "dart") {
    poly(ctx, [[18, 0], [-2, 16], [-2, 7], [-18, 7], [-18, -7], [-2, -7], [-2, -16]])
    ctx.fillStyle = skin.mark
    poly(ctx, [[12, 0], [0, 8], [0, -8]])
    return
  }
  if (skin.shape === "disc") {
    ctx.beginPath()
    ctx.arc(0, 0, 18, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = skin.mark
    ctx.fillRect(-14, -4, 28, 8)
    return
  }
  if (skin.shape === "hex") {
    ring(ctx, 6, 19, Math.PI / 6)
    ctx.fillStyle = skin.mark
    ring(ctx, 6, 8, Math.PI / 6)
    return
  }
  if (skin.shape === "star") {
    star(ctx, 20, 8, -Math.PI / 2)
    ctx.fillStyle = skin.mark
    ctx.beginPath()
    ctx.arc(0, 0, 5, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.fillRect(-18, -18, 36, 36)
  ctx.fillStyle = skin.mark
  poly(ctx, [[-4, -7], [11, 0], [-4, 7]])
}

function drawShip(ctx, skin) {
  ctx.fillStyle = skin.ship
  if (skin.shape === "diamond") {
    poly(ctx, [[22, 0], [-2, 13], [-16, 0], [-2, -13]])
    ctx.fillStyle = skin.flame
    ring(ctx, 4, 5, 0)
    return
  }
  if (skin.shape === "dart") {
    poly(ctx, [[22, 0], [-6, 15], [-16, 8], [2, 0], [-16, -8], [-6, -15]])
    ctx.fillStyle = skin.flame
    poly(ctx, [[8, 0], [-2, 6], [-2, -6]])
    return
  }
  if (skin.shape === "disc") {
    ctx.beginPath()
    ctx.ellipse(2, 0, 20, 11, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = skin.flame
    ctx.beginPath()
    ctx.arc(6, 0, 5, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  if (skin.shape === "hex") {
    ring(ctx, 6, 18, 0)
    ctx.fillStyle = skin.flame
    ctx.fillRect(-16, -3, 8, 6)
    return
  }
  if (skin.shape === "star") {
    star(ctx, 20, 8, 0)
    ctx.fillStyle = skin.flame
    ctx.beginPath()
    ctx.arc(2, 0, 4, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  poly(ctx, [[22, 0], [-16, 14], [-8, 0], [-16, -14]])
  ctx.fillStyle = skin.flame
  ctx.fillRect(-18, -3, 8, 6)
}

export function drawSkin(ctx, skin, mode = "cube") {
  if (mode === "ship") drawShip(ctx, skin)
  else drawCube(ctx, skin)
}
