import { DeckAudioEngine } from './DeckAudioEngine';

export type CrossfaderCurve = 'smooth' | 'scratch';

/**
 * 2デッキの出力をクロスフェーダーで混ぜてマスターへ送るクラス。
 *
 * クロスフェーダーカーブは PIONEER DJ の Magvel Fader Pro を意識して2種類切替可能:
 *  - 'smooth' : イコールパワー(等パワー)カーブ。中央付近の音量落ち込みを防ぐミックス向け
 *  - 'scratch': 中央付近の遷移を急峻にした、スクラッチの高速カットに向くカーブ
 *
 * また DJM-S11 の Beat FX(Echo) 相当として、マスター段にディレイのセンド/リターンを
 * 常設し、on/off切替とテンポに応じたディレイタイムの再計算に対応する。
 */
export class MixerEngine {
  readonly audioCtx: AudioContext;
  private gainA: GainNode;
  private gainB: GainNode;
  private master: GainNode;
  private finalOut: GainNode;
  private limiter: DynamicsCompressorNode;

  private delay: DelayNode;
  private delayFeedback: GainNode;
  private delayWet: GainNode;

  private _crossfade = 0; // -1(A) 〜 +1(B)
  private _masterVolume = 0.9;
  private _curve: CrossfaderCurve = 'smooth';
  private _beatFxOn = false;

  constructor(audioCtx: AudioContext, deckA: DeckAudioEngine, deckB: DeckAudioEngine) {
    this.audioCtx = audioCtx;

    this.gainA = this.audioCtx.createGain();
    this.gainB = this.audioCtx.createGain();
    this.master = this.audioCtx.createGain();
    this.master.gain.value = this._masterVolume;

    deckA.output.connect(this.gainA);
    deckB.output.connect(this.gainB);
    this.gainA.connect(this.master);
    this.gainB.connect(this.master);

    // マスター段の最終合流点。ドライ(master)とBeat FXのウェット分をここで合算してから
    // リミッターに通す(片方だけ突っ込んで歪むのを防ぐ)
    this.finalOut = this.audioCtx.createGain();
    this.master.connect(this.finalOut);

    // Beat FX(Echo): マスターからセンドしてディレイ→フィードバックのループを作り、
    // ウェット分だけ finalOut に混ぜる
    this.delay = this.audioCtx.createDelay(2.0);
    this.delay.delayTime.value = 60 / 128 / 2; // 初期値: 128BPMの8分音符相当
    this.delayFeedback = this.audioCtx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayWet = this.audioCtx.createGain();
    this.delayWet.gain.value = 0; // デフォルトはOFF

    this.master.connect(this.delay);
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.finalOut);

    // マスターリミッター(常時挿入)。突発的な音割れを防ぎ、DJM実機のクリップLEDに相当する
    // reduction(現在のゲイン低減量, dB)を Mixer 側のLED表示に使う
    this.limiter = this.audioCtx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    this.finalOut.connect(this.limiter);
    this.limiter.connect(this.audioCtx.destination);

    this.applyCrossfade();
  }

  get crossfade() { return this._crossfade; }
  get curve() { return this._curve; }
  get beatFxOn() { return this._beatFxOn; }
  /** 現在のリミッターによるゲイン低減量(dB、0以下)。実機のクリップLED表示に利用する */
  get gainReductionDb() { return this.limiter.reduction; }

  setCrossfade(value: number) {
    this._crossfade = Math.min(1, Math.max(-1, value));
    this.applyCrossfade();
  }

  /** クロスフェーダーカーブを切り替える(ミックス向け ⇔ スクラッチ向け) */
  toggleCurve() {
    this._curve = this._curve === 'smooth' ? 'scratch' : 'smooth';
    this.applyCrossfade();
  }

  setMasterVolume(value: number) {
    this._masterVolume = Math.min(1, Math.max(0, value));
    this.master.gain.value = this._masterVolume;
  }

  /** Beat FX(Echo)のon/off。呼び出し時点のBPMでディレイタイムを合わせ直す */
  setBeatFx(on: boolean, syncBpm?: number) {
    this._beatFxOn = on;
    if (syncBpm && syncBpm > 0) this.delay.delayTime.value = 60 / syncBpm / 2;
    this.delayWet.gain.value = on ? 0.32 : 0;
  }

  private applyCrossfade() {
    // -1..1 を 0..1 の位置に変換
    const rawPos = (this._crossfade + 1) / 2;
    const pos = this._curve === 'scratch' ? this.sharpenCurve(rawPos) : rawPos;
    this.gainA.gain.value = Math.cos(pos * 0.5 * Math.PI);
    this.gainB.gain.value = Math.cos((1 - pos) * 0.5 * Math.PI);
  }

  /** 中心からのズレを強調して立ち上がり/立ち下がりを急峻にする(スクラッチカーブ用) */
  private sharpenCurve(pos: number): number {
    const SHARPNESS = 3;
    const centered = pos - 0.5;
    const shaped = Math.sign(centered) * Math.pow(Math.abs(centered) * 2, 1 / SHARPNESS) * 0.5;
    return 0.5 + shaped;
  }
}
