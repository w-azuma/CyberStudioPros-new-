import type { DeckId, HotCue } from '../types';

const PITCH_RANGE = 0.08; // ±8% (実機のピッチフェーダーに近い範囲)

/**
 * デッキ1台分の Web Audio グラフを管理するクラス。
 * ファイル読み込み → 3バンドEQ → チャンネルボリューム → アナライザー → (MixerEngineが繋ぐ先へ)
 *
 * 各デッキが完全に独立した AudioContext/ノード群を持つので、
 * A/Bそれぞれ別の曲を読み込んで別々にEQ・ボリューム・ピッチを操作できる。
 */
export class DeckAudioEngine {
  readonly id: DeckId;
  private _bpm = 128; // 検出前/検出失敗時のフォールバック値
  private _bpmDetected = false;
  private _trackTitle = '';
  private loadGeneration = 0; // 曲の差し替えより後に解析が終わった場合に結果を捨てるための世代カウンタ

  private audioCtx: AudioContext;
  private audioEl: HTMLAudioElement | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  private lowFilter: BiquadFilterNode;
  private midFilter: BiquadFilterNode;
  private highFilter: BiquadFilterNode;
  private colorLowpass: BiquadFilterNode; // Sound Color FX: マイナス側(LPF側)
  private colorHighpass: BiquadFilterNode; // Sound Color FX: プラス側(HPF側)
  private volumeGain: GainNode;
  private analyser: AnalyserNode;
  private freqData: Uint8Array<ArrayBuffer>;

  /** このデッキの出力。MixerEngine 側でクロスフェーダー用ゲインに接続する */
  readonly output: GainNode;

  private _pitch = 0; // -1 〜 1 (実際の再生速度への反映は PITCH_RANGE で縮小)
  private _volume = 0.85; // チャンネルフェーダー
  private _trim = 0; // -1〜1 のトリムノブ。フェーダー値に掛け合わせる
  private _eq = { low: 0, mid: 0, high: 0 }; // -1 〜 1 (dBへは各setterでマッピング)
  private _colorFx = 0; // -1(LPFを絞る) 〜 0(バイパス) 〜 +1(HPFを絞る)。DJM-S11のColor FXノブ相当
  private cuePoint = 0;
  readonly hotCues: HotCue[] = Array.from({ length: 8 }, () => ({ time: null }));

  private trackLoaded = false;

  constructor(id: DeckId, audioCtx: AudioContext) {
    this.id = id;
    this.audioCtx = audioCtx;

    this.lowFilter = audioCtx.createBiquadFilter();
    this.lowFilter.type = 'lowshelf';
    this.lowFilter.frequency.value = 250;

    this.midFilter = audioCtx.createBiquadFilter();
    this.midFilter.type = 'peaking';
    this.midFilter.frequency.value = 1000;
    this.midFilter.Q.value = 0.9;

    this.highFilter = audioCtx.createBiquadFilter();
    this.highFilter.type = 'highshelf';
    this.highFilter.frequency.value = 4000;

    // Sound Color FX: 常時直列に挿しておき、ニュートラル時は可聴帯域の外にカットオフを
    // 逃がすことで実質バイパスにする(ノード自体を繋ぎ変えないシンプルな実装)
    this.colorLowpass = audioCtx.createBiquadFilter();
    this.colorLowpass.type = 'lowpass';
    this.colorLowpass.frequency.value = 20000;
    this.colorLowpass.Q.value = 0.7;

    this.colorHighpass = audioCtx.createBiquadFilter();
    this.colorHighpass.type = 'highpass';
    this.colorHighpass.frequency.value = 20;
    this.colorHighpass.Q.value = 0.7;

    this.volumeGain = audioCtx.createGain();
    this.volumeGain.gain.value = this._volume;

    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.output = audioCtx.createGain();

    this.lowFilter.connect(this.midFilter);
    this.midFilter.connect(this.highFilter);
    this.highFilter.connect(this.colorLowpass);
    this.colorLowpass.connect(this.colorHighpass);
    this.colorHighpass.connect(this.volumeGain);
    this.volumeGain.connect(this.analyser);
    this.analyser.connect(this.output);
  }

  get isLoaded() { return this.trackLoaded; }
  get isPlaying() { return !!this.audioEl && !this.audioEl.paused; }
  get pitch() { return this._pitch; }
  get volume() { return this._volume; }
  get eq() { return this._eq; }
  get colorFx() { return this._colorFx; }
  get bpm() { return this._bpm; }
  get bpmDetected() { return this._bpmDetected; }
  get trackTitle() { return this._trackTitle; }
  get effectiveBpm() { return this.bpm * (1 + this._pitch * PITCH_RANGE); }
  get currentTime() { return this.audioEl?.currentTime ?? 0; }
  get duration() { return this.audioEl?.duration ?? 0; }

  /** 音楽ファイルをこのデッキに読み込む。前の曲が鳴っていれば止めて差し替える */
  loadFile(file: File) {
    this.unload();
    const generation = ++this.loadGeneration;

    const el = new Audio(URL.createObjectURL(file));
    el.loop = true;
    el.crossOrigin = 'anonymous';
    this.sourceNode = this.audioCtx.createMediaElementSource(el);
    this.sourceNode.connect(this.lowFilter);
    this.audioEl = el;
    this.trackLoaded = true;
    this.cuePoint = 0;
    this.hotCues.forEach(c => (c.time = null));
    this._trackTitle = file.name.replace(/\.[^/.]+$/, '');
    this._bpm = 128;
    this._bpmDetected = false;

    el.addEventListener('canplay', () => {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      el.play().catch(() => { /* ユーザー操作前のautoplay制限などは無視 */ });
    }, { once: true });

    this.detectBpm(file, generation);
  }

  /**
   * 簡易的なエネルギー・オートコリレーション方式のBPM自動検出。
   * 曲の先頭60秒程度を解析し、80〜180BPMの範囲でもっとも周期的なエネルギー変動を探す。
   * 本格的なビート検出器ほどの精度はなく、倍/半分のオクターブ違いも起こり得る簡易実装。
   */
  private async detectBpm(file: File, generation: number) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (generation !== this.loadGeneration) return; // 別の曲に差し替わっていたら中断
      const buffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      if (generation !== this.loadGeneration) return;

      const bpm = estimateBpm(buffer);
      if (generation !== this.loadGeneration) return;
      this._bpm = bpm;
      this._bpmDetected = true;
    } catch {
      // デコード失敗時などはフォールバック値(128)のまま据え置く
    }
  }

  private unload() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.sourceNode?.disconnect();
    }
    this.audioEl = null;
    this.sourceNode = null;
    this.trackLoaded = false;
  }

  togglePlay() {
    if (!this.audioEl) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    if (this.audioEl.paused) this.audioEl.play().catch(() => {});
    else this.audioEl.pause();
  }

  /** CDJ的なCueボタンの挙動: 再生中に押すとキューポイントへ戻って一時停止、
   *  停止中に押すと現在位置をキューポイントとして打ち直す */
  pressCue() {
    if (!this.audioEl) return;
    if (this.audioEl.paused) {
      this.cuePoint = this.audioEl.currentTime;
    } else {
      this.audioEl.pause();
      this.audioEl.currentTime = this.cuePoint;
    }
  }

  /** ホットキューパッド操作: 未セットなら現在位置を記録、セット済みならジャンプする。
   *  Shiftを押しながらの場合はクリアする想定(呼び出し側でindex制御) */
  triggerHotCue(index: number, clear = false) {
    if (!this.audioEl) return;
    const cue = this.hotCues[index];
    if (clear) {
      cue.time = null;
      return;
    }
    if (cue.time === null) {
      cue.time = this.audioEl.currentTime;
    } else {
      this.audioEl.currentTime = cue.time;
      if (this.audioEl.paused) this.audioEl.play().catch(() => {});
    }
  }

  /** -1〜1 で受け取り、±PITCH_RANGE の再生速度に変換して適用する */
  setPitch(value: number) {
    this._pitch = THREE_clamp(value, -1, 1);
    if (this.audioEl && !this.scratching) this.audioEl.playbackRate = 1 + this._pitch * PITCH_RANGE;
  }

  private scratching = false;

  /** プラッターをドラッグしている間だけ再生速度を一時的に上書きする(スクラッチ演出) */
  applyScratchRate(rateMultiplier: number) {
    if (!this.audioEl) return;
    this.scratching = true;
    this.audioEl.playbackRate = THREE_clamp((1 + this._pitch * PITCH_RANGE) * rateMultiplier, 0.05, 4);
  }

  /** プラッターを離した時に通常のピッチ倍率へ戻す */
  releaseScratch() {
    this.scratching = false;
    if (this.audioEl) this.audioEl.playbackRate = 1 + this._pitch * PITCH_RANGE;
  }

  /** 他デッキのBPMに合わせてピッチを自動調整する(Syncボタン用) */
  syncTo(otherEffectiveBpm: number) {
    const raw = (otherEffectiveBpm / this.bpm - 1) / PITCH_RANGE;
    this.setPitch(raw);
  }

  /** トーンアームのニードルドロップ操作用。0〜1(曲頭〜曲末)の位置をシークする */
  seekTo(fraction: number) {
    if (!this.audioEl || !isFinite(this.audioEl.duration) || this.audioEl.duration <= 0) return;
    this.audioEl.currentTime = THREE_clamp(fraction, 0, 1) * this.audioEl.duration;
  }

  setVolume(value: number) {
    this._volume = THREE_clamp(value, 0, 1);
    this.applyVolumeGain();
  }

  get trim() { return this._trim; }

  setTrim(value: number) {
    this._trim = THREE_clamp(value, -1, 1);
    this.applyVolumeGain();
  }

  private applyVolumeGain() {
    this.volumeGain.gain.value = THREE_clamp(this._volume * (1 + this._trim * 0.5), 0, 1.5);
  }

  /** band: 'low' | 'mid' | 'high', value: -1〜1 (-1=-15dB, 0=フラット, 1=+15dB) */
  setEq(band: 'low' | 'mid' | 'high', value: number) {
    const v = THREE_clamp(value, -1, 1);
    this._eq[band] = v;
    const gainDb = v * 15;
    if (band === 'low') this.lowFilter.gain.value = gainDb;
    if (band === 'mid') this.midFilter.gain.value = gainDb;
    if (band === 'high') this.highFilter.gain.value = gainDb;
  }

  /**
   * DJM-S11の「Sound Color FX(Filter)」相当。ノブを左(-1)に回すほどLPFのカットオフが
   * 下がって曇った音に、右(+1)に回すほどHPFのカットオフが上がって痩せた音になる。
   * さらに回し切りに近づくほどQ(共鳴)を持ち上げて、フィルターらしい「クセ」を強調する。
   */
  setColorFx(value: number) {
    this._colorFx = THREE_clamp(value, -1, 1);
    const t = Math.abs(this._colorFx);

    if (this._colorFx <= 0) {
      // 20kHz(バイパス相当) 〜 200Hz まで指数的にカットオフを下げる
      this.colorLowpass.frequency.value = 20000 * Math.pow(200 / 20000, t);
      this.colorLowpass.Q.value = 0.7 + t * 8;
      this.colorHighpass.frequency.value = 20;
      this.colorHighpass.Q.value = 0.7;
    } else {
      this.colorHighpass.frequency.value = 20 * Math.pow(3000 / 20, t);
      this.colorHighpass.Q.value = 0.7 + t * 8;
      this.colorLowpass.frequency.value = 20000;
      this.colorLowpass.Q.value = 0.7;
    }
  }

  /** low〜highのビン範囲を平均して0〜1に正規化 */
  getAudioLevel(low: number, high: number): number {
    if (!this.trackLoaded) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = low; i < high; i++) sum += this.freqData[i];
    return sum / (high - low) / 255;
  }
}

// clamp するのに three.js の MathUtils をわざわざ import するほどでもないので簡易実装
function THREE_clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * AudioBufferからBPMを推定する。手順:
 *  1) モノラル化した波形を先頭60秒程度に絞る
 *  2) 整流(絶対値化)した振幅を短い窓(hop)ごとに平均し、エネルギーの推移(エンベロープ)を作る
 *  3) 移動平均を引いて緩やかな音量変化(DC成分)を除去し、拍のゆらぎだけを残す
 *  4) 80〜180BPMに相当する範囲でエンベロープの自己相関を計算し、最もスコアの高い周期を採用
 *  5) 一般的なダンス/ヒップホップのテンポ域(85〜175BPM)に収まるよう必要ならオクターブ補正
 */
function estimateBpm(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate;
  const channelData = averageChannels(buffer);

  const maxSamples = Math.min(channelData.length, sampleRate * 60);
  const hop = 1024;
  const envLength = Math.floor(maxSamples / hop);
  if (envLength < 8) return 128;

  const envelope = new Float32Array(envLength);
  for (let i = 0; i < envLength; i++) {
    let sum = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) sum += Math.abs(channelData[start + j] ?? 0);
    envelope[i] = sum / hop;
  }
  const envRate = sampleRate / hop; // エンベロープ1サンプルあたりの実時間分解能(Hz)

  const smoothed = subtractMovingAverage(envelope, Math.round(envRate * 0.5));

  const minLag = Math.max(1, Math.round((envRate * 60) / 180));
  const maxLag = Math.round((envRate * 60) / 80);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i + lag < smoothed.length; i++) score += smoothed[i] * smoothed[i + lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return 128;

  const rawBpm = (60 * envRate) / bestLag;
  return normalizeBpmOctave(rawBpm);
}

function averageChannels(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const out = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

function subtractMovingAverage(data: Float32Array, windowSize: number): Float32Array {
  const w = Math.max(1, windowSize);
  const out = new Float32Array(data.length);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= w) sum -= data[i - w];
    const avg = sum / Math.min(i + 1, w);
    out[i] = data[i] - avg;
  }
  return out;
}

function normalizeBpmOctave(bpm: number): number {
  let v = bpm;
  while (v < 85 && v > 0) v *= 2;
  while (v > 175) v /= 2;
  return Math.round(v * 10) / 10;
}
