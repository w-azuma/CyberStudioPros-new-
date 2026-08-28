import * as THREE from 'three';
import type { DeckAudioEngine } from '../audio/DeckAudioEngine';
import type { MixerEngine } from '../audio/MixerEngine';
import type { DraggableControl } from '../types';

type Band = 'high' | 'mid' | 'low' | 'trim';
const ROW_BANDS: Band[] = ['high', 'mid', 'low', 'trim'];
const KNOB_ANGLE_RANGE = Math.PI * 0.65; // ノブの回転角(見た目)

/** ミキサーセクション: クロスフェーダー、チャンネルフェーダー、EQ/トリムノブ、VUメーター */
export class Mixer {
  readonly group = new THREE.Group();
  readonly controls: DraggableControl[] = [];

  private vuLampsA: THREE.Mesh[] = [];
  private vuLampsB: THREE.Mesh[] = [];
  private crossfaderMesh!: THREE.Mesh;
  private curveLeverKnob!: THREE.Mesh;
  private beatFxButton!: THREE.Mesh;
  private limitLed!: THREE.Mesh;
  private mixerEngine: MixerEngine;
  private deckA: DeckAudioEngine;
  private deckB: DeckAudioEngine;

  constructor(scene: THREE.Scene, mixerEngine: MixerEngine, deckA: DeckAudioEngine, deckB: DeckAudioEngine) {
    this.mixerEngine = mixerEngine;
    this.deckA = deckA;
    this.deckB = deckB;
    this.group.position.set(0, 2.1, 0);
    scene.add(this.group);

    this.buildChannelFaders();
    this.buildCrossfader();
    this.buildCrossfaderCurveSwitch();
    this.buildEqKnobs();
    this.buildColorFxKnobs();
    this.buildBeatFxButton();
    this.buildVuMeters();
    this.buildLimitLed();
  }

  private buildChannelFaders() {
    const mkFader = (x: number, engine: DeckAudioEngine) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.6), new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1 }));
      f.position.set(x, 0.5, 8);
      this.group.add(f);

      this.controls.push({
        object3D: f,
        axis: 'y',
        onDrag: (deltaPx) => engine.setVolume(engine.volume - deltaPx * 0.004),
        syncVisual: () => { f.position.y = -0.6 + engine.volume * 2.2; },
      });
    };
    mkFader(-2.5, this.deckA);
    mkFader(2.5, this.deckB);
  }

  private buildCrossfader() {
    this.crossfaderMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 0.8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1 }));
    this.crossfaderMesh.position.set(0, 0.2, 12);
    this.group.add(this.crossfaderMesh);

    this.controls.push({
      object3D: this.crossfaderMesh,
      axis: 'x',
      onDrag: (deltaPx) => this.mixerEngine.setCrossfade(this.mixerEngine.crossfade + deltaPx * 0.006),
      syncVisual: () => { this.crossfaderMesh.position.x = this.mixerEngine.crossfade * 3; },
    });
  }

  /**
   * PIONEER DJ Magvel Fader Pro を意識した、クロスフェーダーカーブの切替レバー。
   * ドラッグ量ではなくクリックのみで反応させ、2ポジション(SMOOTH/SCRATCH)をトグルする。
   */
  private buildCrossfaderCurveSwitch() {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x000000 }));
    rail.position.set(0, 0.75, 13.4);
    this.group.add(rail);

    this.curveLeverKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.6, metalness: 0.6 })
    );
    this.curveLeverKnob.rotation.x = Math.PI / 2;
    rail.add(this.curveLeverKnob);

    this.controls.push({
      object3D: this.curveLeverKnob,
      axis: 'x',
      onDrag: () => {},
      onClick: () => this.mixerEngine.toggleCurve(),
      syncVisual: () => {
        const isScratch = this.mixerEngine.curve === 'scratch';
        this.curveLeverKnob.position.x = isScratch ? 0.9 : -0.9;
        const mat = this.curveLeverKnob.material as THREE.MeshStandardMaterial;
        const color = isScratch ? 0xff007b : 0x00ff88;
        mat.color.setHex(color);
        mat.emissive.setHex(color);
      },
    });
  }

  /**
   * DJM-S11の「Sound Color FX」相当のフィルターノブ。EQ列よりさらに奥(手前から遠い側)に
   * 1個ずつ配置し、リング発光を強めにして質感の違うノブであることを示す。
   */
  private buildColorFxKnobs() {
    const knobGeo = new THREE.CylinderGeometry(0.45, 0.5, 0.8, 32);

    ([-1, 1] as const).forEach((col) => {
      const engine = col === -1 ? this.deckA : this.deckB;
      const knobGroup = new THREE.Group();
      knobGroup.position.set(col * 2.5, 0.4, -6.4);
      this.group.add(knobGroup);

      const knob = new THREE.Mesh(knobGeo, new THREE.MeshStandardMaterial({ color: 0x1a0a1a, metalness: 0.8, roughness: 0.3 }));
      knobGroup.add(knob);

      const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.45), new THREE.MeshBasicMaterial({ color: 0xff9d00 }));
      indicator.position.set(0, 0.45, 0.2);
      knobGroup.add(indicator);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 12, 48), new THREE.MeshBasicMaterial({ color: 0xff9d00 }));
      ring.rotation.x = Math.PI / 2;
      knobGroup.add(ring);

      this.controls.push({
        object3D: knob,
        axis: 'y',
        onDrag: (deltaPx) => engine.setColorFx(engine.colorFx - deltaPx * 0.006),
        syncVisual: () => { knobGroup.rotation.y = engine.colorFx * KNOB_ANGLE_RANGE; },
      });
    });
  }

  /** DJM-S11の Beat FX (Echo) on/offボタン。点灯中はテンポに合わせたディレイがマスターにかかる */
  private buildBeatFxButton() {
    this.beatFxButton = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.3, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x220011, emissive: 0xff2050, emissiveIntensity: 0.2 })
    );
    this.beatFxButton.position.set(0, 0.9, -8.6);
    this.group.add(this.beatFxButton);

    this.controls.push({
      object3D: this.beatFxButton,
      axis: 'y',
      onDrag: () => {},
      onClick: () => {
        const avgBpm = (this.deckA.effectiveBpm + this.deckB.effectiveBpm) / 2;
        this.mixerEngine.setBeatFx(!this.mixerEngine.beatFxOn, avgBpm);
      },
      syncVisual: () => {
        const mat = this.beatFxButton.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = this.mixerEngine.beatFxOn ? 2.2 : 0.2;
      },
    });
  }

  private buildEqKnobs() {
    const knobGeo = new THREE.CylinderGeometry(0.4, 0.45, 0.7, 32);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.4 });

    for (let row = 0; row < 4; row++) {
      for (const col of [-1, 1] as const) {
        const engine = col === -1 ? this.deckA : this.deckB;
        const band = ROW_BANDS[row];

        const knobGroup = new THREE.Group();
        knobGroup.position.set(col * 2.5, 0.4, -4 + row * 2.2);
        this.group.add(knobGroup);

        const knob = new THREE.Mesh(knobGeo, knobMat);
        knobGroup.add(knob);

        const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.4), new THREE.MeshBasicMaterial({ color: 0x00f2ff }));
        indicator.position.set(0, 0.4, 0.2);
        knobGroup.add(indicator);

        const getValue = () => (band === 'trim' ? engine.trim : engine.eq[band]);
        const setValue = (v: number) => {
          if (band === 'trim') engine.setTrim(v);
          else engine.setEq(band, v);
        };

        this.controls.push({
          object3D: knob,
          axis: 'y',
          onDrag: (deltaPx) => setValue(getValue() - deltaPx * 0.006),
          syncVisual: () => { knobGroup.rotation.y = getValue() * KNOB_ANGLE_RANGE; },
        });
      }
    }
  }

  private buildVuMeters() {
    const mk = (side: -1 | 1) => {
      const arr: THREE.Mesh[] = [];
      for (let i = 0; i < 22; i++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        lamp.position.set(side * 0.7, 0, -2 + i * 0.45);
        this.group.add(lamp);
        arr.push(lamp);
      }
      return arr;
    };
    this.vuLampsA = mk(-1);
    this.vuLampsB = mk(1);
  }

  /** マスターリミッターの動作を示すLED(DJM実機のPEAK/CLIP LED相当)。ここは常時発光しリダクション量で輝度が変わる */
  private buildLimitLed() {
    this.limitLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 0 })
    );
    this.limitLed.position.set(0, 1.1, -9.6);
    this.group.add(this.limitLed);
  }

  /** VUメーターの毎フレーム更新(オーディオレベルに応じて点灯個数と色を変える) */
  update(elapsed: number) {
    const drive = (lamps: THREE.Mesh[], engine: DeckAudioEngine, phase: number) => {
      lamps.forEach((l, i) => {
        const level = engine.isLoaded
          ? engine.getAudioLevel(i, i + 1) * 22
          : (Math.sin(elapsed * 20 + i * 0.1 + phase) * 0.5 + 0.5) * 22;
        const mat = l.material as THREE.MeshStandardMaterial;
        if (i < level) {
          const col = i > 18 ? 0xff0000 : i > 14 ? 0xffff00 : 0x00ff00;
          mat.color.setHex(col);
          mat.emissive.setHex(col);
          mat.emissiveIntensity = 2;
        } else {
          mat.color.setHex(0x111111);
          mat.emissiveIntensity = 0;
        }
      });
    };
    drive(this.vuLampsA, this.deckA, 0);
    drive(this.vuLampsB, this.deckB, 1);

    // リダクション量(0以下のdB)が大きいほど明るく光らせる。-1dBも掛かっていなければ消灯
    const reduction = -this.mixerEngine.gainReductionDb;
    const mat = this.limitLed.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = reduction > 1 ? THREE.MathUtils.clamp(reduction / 6, 0.3, 3) : 0;
  }
}
