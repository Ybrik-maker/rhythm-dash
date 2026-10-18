function yieldNow() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function alpha(sampleRate, freq) {
  const dt = 1 / sampleRate
  const rc = 1 / (2 * Math.PI * freq)
  return dt / (rc + dt)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1)
  return sorted[index]
}

function mixDown(audioBuffer, targetRate) {
  const channel = audioBuffer.getChannelData(0)
  const channel2 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null
  const ratio = audioBuffer.sampleRate / targetRate
  const length = Math.max(1, Math.floor(channel.length / ratio))
  const data = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(channel.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = start; j < end; j += 1) sum += channel2 ? (channel[j] + channel2[j]) * 0.5 : channel[j]
    data[i] = sum / (end - start)
  }
  return data
}

function estimateTempo(onsets, onsetStrength, hop, duration) {
  const times = []
  for (let i = 1; i < onsets.length; i += 1) {
    const gap = (onsets[i] - onsets[i - 1]) * hop
    if (gap > 0.18 && gap < 1.15) times.push(gap)
  }

  let best = { bpm: 120, score: 0 }
  for (let bpm = 78; bpm <= 176; bpm += 0.5) {
    const period = 60 / bpm
    let score = 0
    if (times.length) {
      for (const gap of times) {
        const multiple = Math.max(1, Math.round(gap / period))
        const error = Math.abs(gap - multiple * period) / period
        if (error < 0.11) score += (1 - error / 0.11) * (multiple === 1 ? 1.35 : 0.65)
      }
      score /= times.length
    }
    let grid = 0
    let count = 0
    for (let time = 0; time < duration; time += period) {
      const index = Math.round(time / hop)
      if (index >= 0 && index < onsetStrength.length) {
        grid += onsetStrength[index]
        count += 1
      }
    }
    const gridMean = count ? grid / count : 0
    const combined = score * 0.72 + gridMean * 0.28
    const centerBias = 1 - Math.min(0.12, Math.abs(bpm - 126) / 500)
    if (combined * centerBias > best.score) best = { bpm, score: combined * centerBias }
  }

  const confidence = clamp(best.score / 0.55, 0, 1)
  return { bpm: best.bpm, confidence }
}

function bestPhase(onsetStrength, hop, bpm, duration) {
  const period = 60 / bpm
  let bestPhaseValue = 0
  let bestScore = -1
  for (let phase = 0; phase < period; phase += 0.01) {
    let score = 0
    for (let time = phase; time < duration; time += period) {
      const index = Math.round(time / hop)
      if (index >= 0 && index < onsetStrength.length) score += onsetStrength[index]
    }
    if (score > bestScore) {
      bestScore = score
      bestPhaseValue = phase
    }
  }
  return bestPhaseValue
}

function compact(series, fromHop, toHop) {
  const out = []
  const group = Math.max(1, Math.round(toHop / fromHop))
  for (let i = 0; i < series.length; i += group) {
    let sum = 0
    let count = 0
    for (let j = i; j < Math.min(series.length, i + group); j += 1) {
      sum += series[j]
      count += 1
    }
    out.push(count ? sum / count : 0)
  }
  return out
}

function normalize(values) {
  const peak = percentile(values, 0.94) || 1
  return values.map((value) => clamp(value / peak, 0, 1.4))
}

function smoothActivity(activity) {
  return activity.map((value, index) => {
    const a = activity[Math.max(0, index - 1)]
    const c = activity[Math.min(activity.length - 1, index + 1)]
    return (a + value + c) / 3
  })
}

function buildSections(activity, hop, duration) {
  if (!activity.length) return [{ type: "drop", start: 0, end: duration }]
  const smoothed = smoothActivity(activity)
  let peak = 0
  for (const value of smoothed) if (value > peak) peak = value
  const onCut = peak * 0.8
  const offCut = peak * 0.64
  const outroAt = duration - Math.min(5.5, Math.max(3, duration * 0.1))
  const drops = []
  let run = null
  let quiet = 0
  const limit = Math.min(smoothed.length, Math.ceil(outroAt / hop))
  for (let i = 0; i < limit; i += 1) {
    const energy = smoothed[i]
    const time = i * hop
    if (energy >= onCut) {
      if (!run) run = { start: time, end: time + hop, peak: energy }
      else {
        run.end = time + hop
        run.peak = Math.max(run.peak, energy)
      }
      quiet = 0
    } else if (run) {
      quiet += hop
      if (energy < offCut || quiet >= 0.75) {
        if (run.end - run.start >= 1.15 && run.peak >= peak * 0.9) drops.push(run)
        run = null
        quiet = 0
      } else run.end = time + hop
    }
  }
  if (run && run.end - run.start >= 1.15 && run.peak >= peak * 0.9) drops.push(run)
  if (!drops.length) {
    let best = 0
    let bestAt = 0
    for (let i = 0; i < limit; i += 1) {
      if (smoothed[i] > best) {
        best = smoothed[i]
        bestAt = i * hop
      }
    }
    drops.push({ start: Math.max(0, bestAt - 1.2), end: Math.min(outroAt, bestAt + 3.2), peak: best })
  }

  const sections = []
  let cursor = 0
  for (const drop of drops) {
    const start = Math.max(cursor, drop.start)
    if (start - cursor > 0.35) {
      if (cursor < 1.4) {
        const riseAt = Math.max(cursor, start - Math.min(6, (start - cursor) * 0.5))
        if (riseAt - cursor > 0.35) sections.push({ type: "intro", start: cursor, end: riseAt })
        if (start - riseAt > 0.25) sections.push({ type: "rise", start: Math.max(cursor, riseAt), end: start })
      } else {
        const riseAt = Math.max(cursor, start - Math.min(4, (start - cursor) * 0.35))
        if (riseAt - cursor > 0.4) sections.push({ type: "break", start: cursor, end: riseAt })
        if (start - riseAt > 0.25) sections.push({ type: "rise", start: riseAt, end: start })
      }
    }
    if (drop.end - start > 0.4) sections.push({ type: "drop", start, end: drop.end })
    cursor = Math.max(cursor, drop.end)
  }
  if (duration - cursor > 0.25) {
    if (cursor < outroAt - 0.4) sections.push({ type: "break", start: cursor, end: outroAt })
    sections.push({ type: "outro", start: Math.max(cursor, Math.min(outroAt, duration - 0.4)), end: duration })
  }
  if (!sections.length) return [{ type: "drop", start: 0, end: duration }]
  sections[0].start = 0
  sections[sections.length - 1].end = duration
  const merged = []
  for (const section of sections) {
    if (section.end - section.start < 0.2) continue
    const last = merged[merged.length - 1]
    if (last && last.type === section.type) last.end = section.end
    else merged.push(section)
  }
  return merged.length ? merged : [{ type: "drop", start: 0, end: duration }]
}

export function bindSections(features, sections) {
  const duration = features.duration
  const clean = []
  const sorted = [...sections].sort((a, b) => a.start - b.start)
  for (const section of sorted) {
    const start = clamp(section.start, 0, duration)
    const end = clamp(section.end, 0, duration)
    if (end - start < 0.15) continue
    const last = clean[clean.length - 1]
    if (last && last.type === section.type && start - last.end < 0.12) last.end = end
    else clean.push({ type: section.type, start, end })
  }
  if (!clean.length) clean.push({ type: "drop", start: 0, end: duration })
  clean[0].start = 0
  clean[clean.length - 1].end = duration
  features.sections = clean
  features.sectionAt = (time) => {
    for (const section of clean) {
      if (time >= section.start && time < section.end) return section.type
    }
    return clean[clean.length - 1].type
  }
  return features
}

function buildPlateaus(curve, hop) {
  const win = Math.max(4, Math.round(0.55 / hop))
  const plateaus = []
  let runStart = -1
  for (let i = 0; i + win < curve.length; i += 1) {
    const slice = curve.slice(i, i + win).sort((a, b) => a - b)
    const low = slice[Math.floor(slice.length * 0.25)] || 0
    const high = slice[Math.floor(slice.length * 0.8)] || 0
    const held = low >= 0.16 && high <= 0.74 && high - low <= 0.24
    const time = i * hop
    if (held) {
      if (runStart < 0) runStart = time
    } else if (runStart >= 0) {
      const end = time + win * hop
      if (end - runStart >= 1.25) plateaus.push({ start: runStart, end })
      runStart = -1
    }
  }
  if (runStart >= 0) {
    const end = curve.length * hop
    if (end - runStart >= 1.25) plateaus.push({ start: runStart, end })
  }
  return plateaus
}

function carvePlateaus(sections, plateaus) {
  let pieces = sections.map((section) => ({ ...section }))
  for (const plateau of plateaus) {
    const next = []
    for (const section of pieces) {
      const start = Math.max(section.start, plateau.start)
      const end = Math.min(section.end, plateau.end)
      const overlaps = end - start >= 0.9 && section.type !== "outro" && section.type !== "intro"
      if (!overlaps) {
        next.push(section)
        continue
      }
      if (start - section.start > 0.35) next.push({ ...section, end: start })
      next.push({ type: "break", start, end })
      if (section.end - end > 0.35) next.push({ ...section, start: end })
    }
    pieces = next
  }
  const merged = []
  for (const section of pieces) {
    if (section.end - section.start < 0.2) continue
    const last = merged[merged.length - 1]
    if (last && last.type === section.type) last.end = section.end
    else merged.push({ ...section })
  }
  if (!merged.length) return sections
  merged[0].start = 0
  merged[merged.length - 1].end = sections[sections.length - 1].end
  return merged
}

function waveformOf(data) {
  const bars = 140
  const chunk = Math.max(1, Math.floor(data.length / bars))
  const waveform = []
  for (let i = 0; i < bars; i += 1) {
    let min = 0
    let max = 0
    const start = i * chunk
    for (let j = 0; j < chunk; j += 8) {
      const sample = data[start + j] || 0
      if (sample < min) min = sample
      if (sample > max) max = sample
    }
    waveform.push([min, max])
  }
  return waveform
}

export async function analyzeBuffer(audioBuffer, onProgress) {
  const targetRate = 12000
  if (onProgress) {
    onProgress(0.08, "Mixing the audio to one track…")
    await yieldNow()
  }
  const data = mixDown(audioBuffer, targetRate)
  return analyzeSamples(data, targetRate, onProgress, audioBuffer.duration)
}

export async function analyzeSamples(data, sampleRate, onProgress, knownDuration) {
  const duration = knownDuration || data.length / sampleRate
  if (duration < 6) throw new Error("The song is too short. I need at least 6 seconds.")
  if (duration > 12 * 60) throw new Error("The song is longer than 12 minutes. Pick a shorter version.")

  if (onProgress) {
    onProgress(0.22, "Measuring bass, mids, and highs…")
    await yieldNow()
  }

  const lowA = alpha(sampleRate, 150)
  const highA = alpha(sampleRate, 1800)
  const bass = new Float32Array(data.length)
  const high = new Float32Array(data.length)
  let low = 0
  let highState = 0
  for (let i = 0; i < data.length; i += 1) {
    low += lowA * (data[i] - low)
    bass[i] = low
    highState += highA * (data[i] - highState)
    high[i] = data[i] - highState
  }

  const frame = 512
  const hopSamples = 256
  const hop = hopSamples / sampleRate
  const frames = Math.max(1, Math.floor((data.length - frame) / hopSamples))
  const rms = new Float32Array(frames)
  const bassRms = new Float32Array(frames)
  const highRms = new Float32Array(frames)

  if (onProgress) {
    onProgress(0.4, "Finding hits and tempo…")
    await yieldNow()
  }

  for (let index = 0; index < frames; index += 1) {
    const start = index * hopSamples
    let energy = 0
    let bassEnergy = 0
    let highEnergy = 0
    for (let i = 0; i < frame; i += 1) {
      const sample = data[start + i]
      const bassSample = bass[start + i]
      const highSample = high[start + i]
      energy += sample * sample
      bassEnergy += bassSample * bassSample
      highEnergy += highSample * highSample
    }
    rms[index] = Math.sqrt(energy / frame)
    bassRms[index] = Math.sqrt(bassEnergy / frame)
    highRms[index] = Math.sqrt(highEnergy / frame)
  }

  const peakRms = percentile(rms, 0.98)
  if (peakRms < 0.0008) throw new Error("There is no audible sound in the file.")

  const onset = new Float32Array(frames)
  for (let i = 1; i < frames; i += 1) {
    const full = Math.max(0, rms[i] - rms[i - 1])
    const lowFlux = Math.max(0, bassRms[i] - bassRms[i - 1])
    onset[i] = lowFlux * 1.6 + full
  }
  const onsetPeak = percentile(onset, 0.96) || 1
  for (let i = 0; i < onset.length; i += 1) onset[i] /= onsetPeak

  const onsets = []
  const minFrames = Math.max(2, Math.round(0.12 / hop))
  let lastPeak = -minFrames
  for (let i = 2; i < frames - 2; i += 1) {
    if (i - lastPeak < minFrames) continue
    if (onset[i] < onset[i - 1] || onset[i] < onset[i + 1]) continue
    let local = 0
    const span = 24
    const from = Math.max(0, i - span)
    const to = Math.min(frames, i + span)
    for (let j = from; j < to; j += 1) local += onset[j]
    local /= to - from
    if (onset[i] > Math.max(0.16, local * 1.55)) {
      onsets.push(i)
      lastPeak = i
    }
  }

  const tempo = estimateTempo(onsets, onset, hop, duration)
  const phase = bestPhase(onset, hop, tempo.bpm, duration)

  if (onProgress) {
    onProgress(0.68, "Splitting intro, build, drop, and outro…")
    await yieldNow()
  }

  const energy = normalize(Array.from(rms))
  const bassNorm = normalize(Array.from(bassRms))
  const highNorm = normalize(Array.from(highRms))
  const activity = energy.map((value, index) => value * 0.45 + bassNorm[index] * 0.55)
  const activityCompact = normalize(compact(activity, hop, 0.5))
  const energyCurve = compact(energy, hop, 0.05)
  const bassCurve = compact(bassNorm, hop, 0.05)
  const curveHop = 0.05
  const plateaus = buildPlateaus(energyCurve, curveHop)
  const sections = carvePlateaus(buildSections(activityCompact, 0.5, duration), plateaus)
  const peaks = onsets
    .map((index) => ({ t: index * hop, strength: onset[index] }))
    .filter((peak) => peak.strength >= 0.18 && peak.t > 0.4 && peak.t < duration - 0.3)

  let brightSum = 0
  let bassSum = 0
  let samples = 0
  for (let i = 0; i < energy.length; i += 8) {
    const total = energy[i] + bassNorm[i] + highNorm[i] + 1e-4
    brightSum += highNorm[i] / total
    bassSum += bassNorm[i] / total
    samples += 1
  }

  let seed = 2166136261
  for (let i = 0; i < data.length; i += 4096) {
    seed ^= Math.floor((data[i] + 1) * 5000)
    seed = Math.imul(seed, 16777619)
  }

  const sampleAt = (curve) => (time) => {
    if (!curve.length) return 0.4
    const index = clamp(Math.round(time / curveHop), 0, curve.length - 1)
    return curve[index]
  }

  const sectionAtTime = (time) => {
    for (const section of sections) {
      if (time >= section.start && time < section.end) return section.type
    }
    return sections[sections.length - 1]?.type || "drop"
  }

  if (onProgress) {
    onProgress(0.86, "Building the level colors and rhythm…")
    await yieldNow()
  }

  return {
    duration,
    bpm: tempo.bpm,
    confidence: tempo.confidence,
    phase,
    sections,
    brightness: samples ? brightSum / samples : 0.4,
    bassRatio: samples ? bassSum / samples : 0.4,
    seed: seed >>> 0,
    waveform: waveformOf(data),
    energyAt: sampleAt(energyCurve),
    bassAt: sampleAt(bassCurve),
    sectionAt: sectionAtTime,
    onsetCount: onsets.length,
    peaks,
    plateaus,
  }
}
