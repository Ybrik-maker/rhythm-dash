function noiseAt(i) {
  let x = (i * 1103515245 + 12345) & 0x7fffffff
  x = (x * 16807) % 2147483647
  return (x / 2147483647) * 2 - 1
}

function sectionAt(time) {
  if (time < 8) return "intro"
  if (time < 16) return "rise"
  if (time < 32) return "drop"
  if (time < 40) return "break"
  if (time < 48) return "drop"
  return "outro"
}

function addKick(data, sampleRate, time, amp) {
  const start = Math.floor(time * sampleRate)
  const len = Math.floor(sampleRate * 0.2)
  let phase = 0
  for (let i = 0; i < len && start + i < data.length; i += 1) {
    const t = i / sampleRate
    const freq = 190 * Math.exp(-t * 34) + 46
    phase += (2 * Math.PI * freq) / sampleRate
    data[start + i] += Math.sin(phase) * Math.exp(-t * 12) * amp
    if (i < 70) data[start + i] += noiseAt(start + i) * (1 - i / 70) * amp * 0.95
  }
}

function addSnare(data, sampleRate, time, amp) {
  const start = Math.floor(time * sampleRate)
  const len = Math.floor(sampleRate * 0.16)
  for (let i = 0; i < len && start + i < data.length; i += 1) {
    const t = i / sampleRate
    const env = Math.exp(-t * 18)
    data[start + i] += noiseAt(start * 3 + i) * env * amp
    data[start + i] += Math.sin((2 * Math.PI * 180 * i) / sampleRate) * env * amp * 0.25
  }
}

function addHat(data, sampleRate, time, amp) {
  const start = Math.floor(time * sampleRate)
  const len = Math.floor(sampleRate * 0.04)
  for (let i = 0; i < len && start + i < data.length; i += 1) {
    const env = 1 - i / len
    data[start + i] += noiseAt(start + i * 17) * env * env * amp
  }
}

function addSustain(data, sampleRate, time, dur, freq, amp) {
  const start = Math.floor(time * sampleRate)
  const len = Math.floor(dur * sampleRate)
  let phase = 0
  for (let i = 0; i < len && start + i < data.length; i += 1) {
    phase += (2 * Math.PI * freq) / sampleRate
    const edge = Math.min(1, i / (sampleRate * 0.06), (len - i) / (sampleRate * 0.12))
    data[start + i] += Math.sin(phase) * amp * edge
    data[start + i] += Math.sin(phase * 2.01) * amp * 0.35 * edge
  }
}

function addBass(data, sampleRate, time, freq, dur, amp) {
  const start = Math.floor(time * sampleRate)
  const len = Math.floor(dur * sampleRate)
  let phase = 0
  for (let i = 0; i < len && start + i < data.length; i += 1) {
    const t = i / sampleRate
    phase += (2 * Math.PI * freq) / sampleRate
    const env = Math.exp(-t * 7)
    data[start + i] += Math.sin(phase) * env * amp
  }
}

export function makeDemo() {
  const sampleRate = 22050
  const duration = 52
  const bpm = 128
  const beat = 60 / bpm
  const data = new Float32Array(Math.floor(sampleRate * duration))
  const beats = Math.floor((duration - 0.05) / beat)
  const notes = [55, 55, 65.41, 49]

  for (let i = 0; i < beats; i += 1) {
    const time = i * beat
    const section = sectionAt(time)
    if (section === "intro") {
      if (i % 2 === 0) addKick(data, sampleRate, time, 0.55)
      addHat(data, sampleRate, time + beat * 0.5, 0.07)
    } else if (section === "rise") {
      const rise = (time - 8) / 8
      addKick(data, sampleRate, time, 0.6 + rise * 0.45)
      if (i % 2 === 1) addSnare(data, sampleRate, time, 0.18 + rise * 0.25)
      addHat(data, sampleRate, time, 0.08 + rise * 0.08)
      addHat(data, sampleRate, time + beat * 0.5, 0.1)
      addBass(data, sampleRate, time, notes[i % 4], beat * 0.85, 0.12 + rise * 0.12)
    } else if (section === "drop") {
      addKick(data, sampleRate, time, 1)
      if (i % 2 === 1) addSnare(data, sampleRate, time, 0.48)
      addHat(data, sampleRate, time, 0.16)
      addHat(data, sampleRate, time + beat * 0.5, 0.14)
      addBass(data, sampleRate, time, notes[i % 4], beat * 0.92, 0.28)
    } else if (section === "break") {
      if (i % 4 === 0) addKick(data, sampleRate, time, 0.22)
      addHat(data, sampleRate, time + beat * 0.5, 0.05)
    } else {
      const fade = Math.max(0, 1 - (time - 48) / 4)
      if (i % 2 === 0) addKick(data, sampleRate, time, 0.42 * fade)
      addHat(data, sampleRate, time + beat * 0.5, 0.06 * fade)
    }
  }

  addSustain(data, sampleRate, 33.1, 5.6, 220, 0.2)
  addSustain(data, sampleRate, 33.1, 5.6, 330, 0.08)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.tanh(data[i] * 1.15)
  return { data, sampleRate, duration, name: "Demo beat" }
}

export function encodeWav(samples, sampleRate) {
  const length = samples.length
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, "RIFF")
  view.setUint32(4, 36 + length * 2, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, "data")
  view.setUint32(40, length * 2, true)
  let offset = 44
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return buffer
}
