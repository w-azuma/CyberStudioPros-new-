import * as THREE from 'three';
import type { DeckAudioEngine } from '../audio/DeckAudioEngine';
import type { DraggableControl } from '../types';

const PITCH_FADER_HALF_LENGTH = 4; // フェーダーの可動範囲(z軸 ±4)
const PAD_FLASH_MS = 120;

/** ターンテーブル1台分のビジュアルと、それに紐づく操作コントロール群 */
export class Deck {
  readonly group = new THREE.Group();
  readonly controls: DraggableControl[] = [];

  private platter = new THREE.Group();
  private waveBars: THREE.Mesh[] = [];
  private pads: THREE.Mesh[] = [];
  private padFlashUntil: number[] = new Array(8).fill(0);
  private faderKnob!: THREE.Mesh;
  private tonearmPivot = new THREE.Group();
  private labelCtx!: CanvasRenderingContext2D;
  private labelTexture!: THREE.CanvasTexture;
  private lastLabelText = ''; // 前回描画した文字列。変化がなければ再描画をスキップする

  private readonly armMinAngle = 0.08; // パーキング位置(盤の外周)
  private readonly armMaxAngle = 0.95; // 盤の中心寄り(曲の終わり側)

  private visualVelocity = 0; // プラッターの見た目回転速度(スクラッチ演出用)
  private readonly targetVelocity = 0.04;
  private dragging = false;
  private engine: DeckAudioEngine;
  private color: number;

  constructor(engine: DeckAudioEngine, scene: THREE.Scene, x: number, color: number) {
    this.engine = engine;
    this.color = color;
    this.group.position.set(x, 2.1, 0);
    scene.add(this.group);

    this.buildPlatter();
    this.buildStrobeRing();
    this.buildTonearm();
    this.buildPitchFader();
    this.buildPads();
    this.buildWaveform();
  }

  private buildPlatter() {
    const platMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.1 });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(5.2 - i * 0.05, 5.2 - i * 0.05, 0.2, 64), platMat);
      c.position.y = i * 0.2;
      this.platter.add(c);
    }

    this.buildGrooves();
    this.buildLabelDisplay();
    this.group.add(this.platter);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.08, 16, 100), new THREE.MeshBasicMaterial({ color: this.color }));
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    // プラッターへのドラッグ = スクラッチ、クリックのみ = 再生/一時停止
    this.controls.push({
      object3D: this.platter,
      axis: 'x',
      onDrag: (deltaPx) => {
        this.dragging = true;
        this.visualVelocity += deltaPx * 0.02;
        // 動かした速さに応じて再生速度も一時的に変化させる(スクラッチ感)
        const rateMultiplier = 1 + THREE.MathUtils.clamp(deltaPx * 0.15, -0.9, 3);
        this.engine.applyScratchRate(rateMultiplier);
      },
      onClick: () => this.engine.togglePlay(),
      onRelease: () => this.engine.releaseScratch(),
      syncVisual: () => {},
    });
  }

  /** レコード盤らしい同心円の溝を、色味の違う薄いリングを重ねて表現する(装飾のみ) */
  private buildGrooves() {
    for (let r = 2.1; r < 5.05; r += 0.11) {
      const shade = 0x0a0a0a + (Math.round(r * 37) % 2 === 0 ? 0x030303 : 0);
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.018, 6, 80),
        new THREE.MeshStandardMaterial({ color: shade, metalness: 0.85, roughness: 0.25 })
      );
      groove.rotation.x = Math.PI / 2;
      groove.position.y = 0.81;
      this.platter.add(groove);
    }
  }

  /** プラッター中心のレーベル部分をCanvasテクスチャにし、曲名/BPMをCDJの液晶風に表示する */
  private buildLabelDisplay() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    this.labelCtx = canvas.getContext('2d')!;
    this.labelTexture = new THREE.CanvasTexture(canvas);

    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 0.12, 48),
      new THREE.MeshStandardMaterial({
        map: this.labelTexture,
        emissiveMap: this.labelTexture,
        emissive: 0xffffff,
        emissiveIntensity: 0.6,
      })
    );
    label.position.y = 0.82;
    this.platter.add(label);

    this.redrawLabel(); // 初期状態(未読込)を描画しておく
  }

  /** ラベルテクスチャの再描画。内容が変わっていない場合は何もしない(毎フレーム呼んでも軽い) */
  private redrawLabel() {
    const hex = `#${this.color.toString(16).padStart(6, '0')}`;
    const title = this.engine.isLoaded ? this.engine.trackTitle : 'NO TRACK';
    const bpmText = !this.engine.isLoaded
      ? '--- BPM'
      : this.engine.bpmDetected
        ? `${this.engine.bpm.toFixed(1)} BPM`
        : 'ANALYZING...';
    const text = `${title}|${bpmText}`;
    if (text === this.lastLabelText) return;
    this.lastLabelText = text;

    const ctx = this.labelCtx;
    const w = 512, h = 512;
    const cx = w / 2, cy = h / 2;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#050505';
    ctx.beginPath();
    ctx.arc(cx, cy, 256, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hex;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 250, 0, Math.PI * 2);
    ctx.stroke();

    // スピンドル穴
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px monospace';
    const displayTitle = title.length > 16 ? `${title.slice(0, 15)}…` : title;
    ctx.fillText(displayTitle, cx, cy - 90);

    ctx.fillStyle = hex;
    ctx.font = 'bold 40px monospace';
    ctx.fillText(bpmText, cx, cy + 130);

    this.labelTexture.needsUpdate = true;
  }

  /** TECHNICS SL-1200MK7を思わせる、プラッター縁のストロボ点列(装飾のみ・回転に追従しない) */
  private buildStrobeRing() {
    const dotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 });
    const dotGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const count = 50;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(Math.cos(angle) * 5.35, 0.85, Math.sin(angle) * 5.35);
      this.group.add(dot); // 台座側(groupの子)に付けて回転しない基準ラインにする
    }
  }

  /** SL-1200MK7風のトーンアーム。ドラッグで盤上を動かす「針落とし(ニードルドロップ)」操作に対応する */
  private buildTonearm() {
    const armBaseMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.6, 24), armBaseMat);
    base.position.set(6.4, 0.4, -6.4);
    this.group.add(base);

    this.tonearmPivot.position.copy(base.position);
    this.tonearmPivot.rotation.y = this.armMinAngle;
    this.group.add(this.tonearmPivot);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6.2, 12), armBaseMat);
    arm.position.set(-2.6, 0, 0);
    arm.rotation.z = Math.PI / 2;
    this.tonearmPivot.add(arm);

    const headshell = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.35, 0.5),
      new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 0.4 })
    );
    headshell.position.set(-3.1, -0.05, 0);
    arm.add(headshell);

    const counterweight = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 16), armBaseMat);
    counterweight.rotation.z = Math.PI / 2;
    counterweight.position.set(0.9, 0, 0);
    arm.add(counterweight);

    // ヘッドシェルをドラッグすると盤上でアームが振れ、その角度を曲の再生位置に変換する
    // (盤の外周=曲頭、内周寄り=曲の終わり側、という実際のレコードの構造を模している)
    this.controls.push({
      object3D: headshell,
      axis: 'x',
      onDrag: (deltaPx) => {
        const next = THREE.MathUtils.clamp(
          this.tonearmPivot.rotation.y + deltaPx * 0.004,
          this.armMinAngle,
          this.armMaxAngle
        );
        this.tonearmPivot.rotation.y = next;
        const fraction = (next - this.armMinAngle) / (this.armMaxAngle - this.armMinAngle);
        this.engine.seekTo(fraction);
      },
      syncVisual: () => {},
    });
  }

  private buildPitchFader() {
    const faderBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 9), new THREE.MeshStandardMaterial({ color: 0x000000 }));
    faderBase.position.set(8, 0, 0);
    this.group.add(faderBase);

    this.faderKnob = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.8, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, emissive: this.color, emissiveIntensity: 0 })
    );
    faderBase.add(this.faderKnob); // baseの子にしてローカルz座標=フェーダー上の位置として扱う

    this.controls.push({
      object3D: this.faderKnob,
      axis: 'y',
      onDrag: (deltaPx) => {
        // 上にドラッグ(deltaPxが負)でピッチを上げる
        let next = this.engine.pitch - deltaPx * 0.006;
        if (Math.abs(next) < 0.015) next = 0; // 実機のピッチフェーダーにあるセンターデテントを再現
        this.engine.setPitch(next);
      },
      syncVisual: () => {
        this.faderKnob.position.z = this.engine.pitch * PITCH_FADER_HALF_LENGTH;
      },
    });
  }

  private buildPads() {
    for (let i = 0; i < 8; i++) {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.3, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: this.color, emissiveIntensity: 0.2 })
      );
      pad.position.set(-6.5 + (i % 4) * 1.35, 0.1, 8 + Math.floor(i / 4) * 1.35);
      this.group.add(pad);
      this.pads.push(pad);

      const index = i;
      this.controls.push({
        object3D: pad,
        axis: 'y',
        onDrag: () => {},
        onClick: (shiftKey) => {
          this.engine.triggerHotCue(index, shiftKey);
          this.padFlashUntil[index] = performance.now() + PAD_FLASH_MS;
        },
        syncVisual: () => {
          const mat = pad.material as THREE.MeshStandardMaterial;
          const flashing = performance.now() < this.padFlashUntil[index];
          const set = this.engine.hotCues[index].time !== null;
          mat.emissiveIntensity = flashing ? 5 : set ? 0.9 : 0.2;
        },
      });
    }
  }

  private buildWaveform() {
    const bars = new THREE.Group();
    for (let i = 0; i < 60; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 2.5, 0.12),
        new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 2 })
      );
      b.position.set(-3.8 + i * 0.14, 1, -10);
      bars.add(b);
      this.waveBars.push(b);
    }
    this.group.add(bars);
  }

  /** プラッター回転・波形バー・ラベル表示の毎フレーム更新(ポインター操作系はInteractionManagerが処理) */
  update(elapsed: number, idx: number) {
    if (!this.dragging) this.visualVelocity = THREE.MathUtils.lerp(this.visualVelocity, this.engine.isPlaying ? this.targetVelocity : 0, 0.05);
    this.platter.rotation.y += this.visualVelocity;

    const audioOn = this.engine.isLoaded;
    this.waveBars.forEach((bar, i) => {
      const v = audioOn
        ? this.engine.getAudioLevel(i, i + 1)
        : Math.sin(elapsed * 15 + i * 0.2 + idx) * 0.5 + 0.5;
      bar.scale.y = 0.1 + v * (1 + Math.abs(this.visualVelocity) * 20);
    });

    this.redrawLabel();
    this.dragging = false; // このフレームでドラッグ入力が無ければ次フレームで慣性減衰へ戻す
  }

  /** キーボードでのホットキュー操作(1-8など)用 */
  triggerPad(index: number, shiftKey: boolean) {
    if (index < 0 || index >= this.pads.length) return;
    this.engine.triggerHotCue(index, shiftKey);
    this.padFlashUntil[index] = performance.now() + PAD_FLASH_MS;
  }
}
