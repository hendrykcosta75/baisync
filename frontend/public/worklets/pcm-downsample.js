// AudioWorklet that resamples the microphone input to 16 kHz mono PCM16
// and posts Int16Array chunks to the main thread. The Google Live API
// expects 16-bit little-endian PCM at exactly 16 kHz; getting the rate
// wrong by a few percent makes Google interpret the audio as the wrong
// language entirely.
//
// Uses fractional-step linear interpolation so non-integer ratios
// (e.g. 44.1 kHz → 16 kHz, ratio 2.75625) are handled correctly. The
// worklet's global `sampleRate` is the AudioContext rate, which varies
// by browser and device.

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.position = 0
    this.lastSample = 0
    this.buffer = []
    this.flushEvery = 1600 // ~100 ms of output
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel || channel.length === 0) return true

    const ratio = sampleRate / this.targetRate

    while (this.position < channel.length) {
      const idx = Math.floor(this.position)
      const frac = this.position - idx
      const a = idx < 0 ? this.lastSample : channel[idx]
      const b = idx + 1 < channel.length ? channel[idx + 1] : channel[idx]
      const sample = a * (1 - frac) + b * frac
      const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample
      this.buffer.push(clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767))
      this.position += ratio
    }
    this.lastSample = channel[channel.length - 1]
    this.position -= channel.length

    if (this.buffer.length >= this.flushEvery) {
      const out = new Int16Array(this.buffer.length)
      for (let i = 0; i < this.buffer.length; i++) out[i] = this.buffer[i]
      this.port.postMessage(out.buffer, [out.buffer])
      this.buffer.length = 0
    }

    return true
  }
}

registerProcessor('pcm-downsample', PcmDownsampler)
