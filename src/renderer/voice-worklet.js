// Streamy 보이스 — 컴프레서 (들어보기용 AudioWorklet). 나중에 소리 처리 프로그램으로 옮길 같은 계산식.
//   gain computer: 부드러운 무릎(soft knee) / 감지: 피크 → dB / 어택 · 릴리즈는 줄어드는 양(dB)에 걸어 부드럽게
class StreamyComp extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'thr', defaultValue: -20, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 3, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'att', defaultValue: 10, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
      { name: 'rel', defaultValue: 120, minValue: 10, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, minValue: -12, maxValue: 24, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.g = 0;              // 지금 줄이고 있는 양 (dB, 0 이하)
    this.pkIn = -120; this.pkOut = -120; this.pkGr = 0; this.n = 0;
  }
  static gc(x, T, R, W) {
    const d = x - T;
    if (2 * d < -W) return x;
    if (W > 0 && 2 * Math.abs(d) <= W) return x + (1 / R - 1) * Math.pow(d + W / 2, 2) / (2 * W);
    return T + d / R;
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const on = p.on[0] >= 0.5, T = p.thr[0], R = p.ratio[0], W = p.knee[0], mk = p.makeup[0];
    const aC = Math.exp(-1 / (Math.max(0.1, p.att[0]) * 0.001 * sampleRate)), rC = Math.exp(-1 / (Math.max(1, p.rel[0]) * 0.001 * sampleRate));
    const len = inp[0].length, chs = inp.length;
    for (let i = 0; i < len; i++) {
      let pk = 0; for (let c = 0; c < chs; c++) { const v = Math.abs(inp[c][i]); if (v > pk) pk = v; }
      const xdb = 20 * Math.log10(pk + 1e-9);
      const target = on ? StreamyComp.gc(xdb, T, R, W) - xdb : 0;
      this.g = target < this.g ? aC * this.g + (1 - aC) * target : rC * this.g + (1 - rC) * target;
      const gain = Math.pow(10, (this.g + (on ? mk : 0)) / 20);
      let po = 0;
      for (let c = 0; c < out.length; c++) { const v = (inp[c] || inp[0])[i] * gain; out[c][i] = v; const a = Math.abs(v); if (a > po) po = a; }
      if (xdb > this.pkIn) this.pkIn = xdb;
      const odb = 20 * Math.log10(po + 1e-9); if (odb > this.pkOut) this.pkOut = odb;
      if (this.g < this.pkGr) this.pkGr = this.g;
    }
    this.n += len;
    if (this.n >= sampleRate / 40) {        // 초당 40번 화면에 알려 줌
      this.port.postMessage({ in: this.pkIn, out: this.pkOut, gr: this.pkGr });
      this.n = 0; this.pkIn = -120; this.pkOut = -120; this.pkGr = 0;
    }
    return true;
  }
}
registerProcessor('streamy-comp', StreamyComp);
