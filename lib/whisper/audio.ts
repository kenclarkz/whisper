'use client'

/**
 * Procedural horror soundscape — zero audio assets, pure WebAudio.
 *
 *  drone      two detuned low oscillators through a slowly-breathing filter
 *  heartbeat  scheduled double-thump; rate driven by tension (0..1)
 *  sting      dissonant burst for jumpscares / omens
 *  whoosh     filtered noise swell (transitions)
 *  chime      cold bell for sealed votes
 *  knock      dry wooden knocks (something is at the door)
 *
 * Browsers require a user gesture before audio: call `unlock()` from any
 * click/touch handler first.
 */

type Ctx = AudioContext & { whisperMaster?: GainNode }

export class HorrorAudio {
  private ctx: Ctx | null = null
  private master: GainNode | null = null
  private droneNodes: { osc: OscillatorNode[]; lfo: OscillatorNode; gain: GainNode } | null = null
  private heartTimer: ReturnType<typeof setInterval> | null = null
  private noiseBuffer: AudioBuffer | null = null
  muted = false

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.muted = window.localStorage.getItem('whisper.muted') === '1'
      } catch {
        /* noop */
      }
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
    try {
      window.localStorage.setItem('whisper.muted', muted ? '1' : '0')
    } catch {
      /* noop */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05)
    }
    if (muted) this.stopHeartbeat()
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC() as Ctx
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.9
    this.master.connect(this.ctx.destination)
    // Pre-render a shared noise buffer.
    const len = this.ctx.sampleRate * 2
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this.noiseBuffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02 // brown-ish noise
      data[i] = last * 3.5
    }
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0
  }

  /* ---------------- drone ---------------- */

  startDrone() {
    if (!this.ctx || !this.master || this.droneNodes) return
    const ctx = this.ctx
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 2)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 220
    filter.Q.value = 4

    // Slow breathing LFO on the filter.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 90
    lfo.connect(lfoGain).connect(filter.frequency)
    lfo.start()

    const oscs = [55, 55.9, 110.7].map((freq) => {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq
      o.connect(filter)
      o.start()
      return o
    })
    filter.connect(gain).connect(this.master)
    this.droneNodes = { osc: oscs, lfo, gain }
  }

  stopDrone() {
    if (!this.droneNodes || !this.ctx) return
    const { osc, lfo, gain } = this.droneNodes
    gain.gain.setTargetAtTime(0, this.now(), 0.8)
    const nodes = [...osc, lfo]
    setTimeout(() => {
      nodes.forEach((n) => {
        try {
          n.stop()
        } catch {
          /* noop */
        }
      })
      gain.disconnect()
    }, 2500)
    this.droneNodes = null
  }

  /** 0..0.15 extra dread pushed into the drone filter. */
  setDread(amount: number) {
    if (!this.ctx || !this.droneNodes || this.muted) return
    this.droneNodes.gain.gain.setTargetAtTime(0.16 + amount * 0.12, this.now(), 1.5)
  }

  /* ---------------- heartbeat ---------------- */

  startHeartbeat(tension = 0.5) {
    this.stopHeartbeat()
    if (!this.ctx || this.muted) return
    const beat = () => {
      this.thump(0.06 + tension * 0.08)
      setTimeout(() => this.thump((0.06 + tension * 0.08) * 0.75), 180 - tension * 60)
    }
    const period = Math.max(420, 1150 - tension * 650)
    beat()
    this.heartTimer = setInterval(beat, period)
  }

  stopHeartbeat() {
    if (this.heartTimer) {
      clearInterval(this.heartTimer)
      this.heartTimer = null
    }
  }

  private thump(vol: number) {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(58, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.14)
    gain.gain.setValueAtTime(vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16)
    osc.connect(gain).connect(this.master)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
  }

  /* ---------------- one-shots ---------------- */

  sting() {
    if (!this.ctx || !this.master || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    ;[660, 699, 987].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12 - i * 0.03, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
      osc.connect(gain).connect(this.master!)
      osc.start(t)
      osc.stop(t + 1.5)
    })
  }

  whoosh(dur = 1.2) {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.1
    filter.frequency.setValueAtTime(120, t)
    filter.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.7)
    filter.frequency.exponentialRampToValueAtTime(90, t + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.6)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.1)
  }

  chime() {
    if (!this.ctx || !this.master || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    ;[523.25, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.18 / (i + 1), t + i * 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
      osc.connect(gain).connect(this.master!)
      osc.start(t + i * 0.04)
      osc.stop(t + 2.4)
    })
  }

  knock(count = 3) {
    if (!this.ctx || !this.master || !this.noiseBuffer || this.muted) return
    const ctx = this.ctx
    for (let k = 0; k < count; k++) {
      const t = ctx.currentTime + k * 0.42
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      src.playbackRate.value = 0.7
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 300
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.5, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      src.connect(filter).connect(gain).connect(this.master)
      src.start(t)
      src.stop(t + 0.12)
    }
  }
}

/** Singleton — one soundscape per page. */
let singleton: HorrorAudio | null = null
export function getAudio(): HorrorAudio {
  if (!singleton) singleton = new HorrorAudio()
  return singleton
}
