import * as THREE from 'three';
import type { DeckAudioEngine } from '../audio/DeckAudioEngine';

interface ScreenEntry {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  type: 'mixer' | 'waves' | 'data';
}

/** ブース上部に浮かぶ3枚のモニター。曲のレベルとBPMを表示する */
export class Monitors {
  private screens: ScreenEntry[] = [];
  private deckA: DeckAudioEngine;
  private deckB: DeckAudioEngine;

  constructor(scene: THREE.Scene, deckA: DeckAudioEngine, deckB: DeckAudioEngine) {
    this.deckA = deckA;
    this.deckB = deckB;
    const screenTypes: ScreenEntry['type'][] = ['mixer', 'waves', 'data'];
    [-1, 0, 1].forEach((pos, idx) => {
      const mGroup = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(38, 22, 1.5), new THREE.MeshStandardMaterial({ color: 0x000000 }));
      mGroup.add(frame);

      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);

      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(36, 20),
        new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.1 })
      );
      screen.position.z = 0.8;
      mGroup.add(screen);
      this.screens.push({ ctx, tex, type: screenTypes[idx] });

      mGroup.position.set(pos * 40, 28, -40);
      mGroup.rotation.y = -pos * 0.4;
      scene.add(mGroup);
    });
  }

  update(time: number) {
    const w = 1024, h = 512;
    this.screens.forEach(s => {
      const { ctx, tex, type } = s;
      ctx.fillStyle = '#020205';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#111122';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
      }

      if (type === 'waves') {
        const level = 0.3 + this.deckA.getAudioLevel(0, 40) * 0.7;
        ctx.strokeStyle = '#00f2ff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * 0.01 + time * 10) * 100 * level;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px Arial';
        ctx.fillText('CHANNEL MASTER v3.0 - STABLE', 50, 80);
      } else if (type === 'mixer') {
        ctx.fillStyle = '#ff007b';
        for (let i = 0; i < 16; i++) {
          const level = this.deckB.getAudioLevel(i, i + 1) || Math.abs(Math.sin(time * 5 + i)) * 0.6;
          const v = level * 300;
          ctx.fillRect(100 + i * 50, h - v - 50, 30, v);
        }
      } else {
        ctx.fillStyle = '#00f2ff';
        ctx.font = '70px monospace';
        ctx.fillText(`A ${this.deckA.effectiveBpm.toFixed(2)}`, w / 2 - 260, h / 2 - 40);
        ctx.fillStyle = '#ff007b';
        ctx.fillText(`B ${this.deckB.effectiveBpm.toFixed(2)}`, w / 2 - 260, h / 2 + 60);
        ctx.fillStyle = '#ffffff';
        ctx.font = '26px Arial';
        ctx.fillText('SYSTEM OK // LATENCY 2ms', w / 2 - 260, h / 2 + 120);
      }
      tex.needsUpdate = true;
    });
  }
}
