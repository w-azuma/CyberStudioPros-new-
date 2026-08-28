import * as THREE from 'three';
import type { DraggableControl } from '../types';

const CLICK_THRESHOLD_PX = 4;

/**
 * 3Dコントロール(ノブ・フェーダー・パッド・プラッター)への
 * ポインター操作をまとめて処理するクラス。
 *
 * 方式: pointerdown時だけレイキャストしてどのコントロールを掴んだかを判定し、
 * 以降のドラッグはスクリーン座標の差分(px)で処理する。
 * これによりコントロールごとに複雑な3D平面交差計算を書かずに済む。
 *
 * OrbitControls と共存させるため、コントロールに当たった場合のみ
 * イベントの伝播を止めてカメラ回転を無効化する。
 */
export class InteractionManager {
  private controls: DraggableControl[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private active: DraggableControl | null = null;
  private lastX = 0;
  private lastY = 0;
  private movedPx = 0;
  private shiftKey = false;

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  private orbitControls: { enabled: boolean };

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.Camera, orbitControls: { enabled: boolean }) {
    this.renderer = renderer;
    this.camera = camera;
    this.orbitControls = orbitControls;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  /** Deck/Mixer が自分のコントロール一覧をまとめて登録する */
  register(controls: DraggableControl[]) {
    this.controls.push(...controls);
  }

  /** 毎フレーム呼び出して見た目を最新の値に同期する */
  updateVisuals() {
    for (const c of this.controls) c.syncVisual();
  }

  private onPointerDown = (e: PointerEvent) => {
    this.updatePointerNDC(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshes = this.controls.map(c => c.object3D);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return;

    // ヒットしたメッシュ(または子孫)を持つコントロールを特定
    const hitObject = hits[0].object;
    const found = this.controls.find(c => c.object3D === hitObject || isDescendantOf(hitObject, c.object3D));
    if (!found) return;

    this.active = found;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.movedPx = 0;
    this.shiftKey = e.shiftKey;
    this.orbitControls.enabled = false; // ドラッグ中はカメラを回さない
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.active) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    const delta = this.active.axis === 'x' ? dx : dy;
    this.movedPx += Math.abs(delta);
    if (delta !== 0) this.active.onDrag(delta);
  };

  private onPointerUp = () => {
    if (this.active) {
      if (this.movedPx < CLICK_THRESHOLD_PX && this.active.onClick) {
        this.active.onClick(this.shiftKey);
      }
      this.active.onRelease?.();
      this.orbitControls.enabled = true;
    }
    this.active = null;
  };

  private updatePointerNDC(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }
}

function isDescendantOf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}
