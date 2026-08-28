import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface Woofer { mesh: THREE.Mesh; initialZ: number; }

/**
 * ブース全体の静的な部分(照明・床・筐体・机・スピーカー・背景ケーブル)と
 * レンダリングパイプライン(カメラ/コントロール/ブルーム)をまとめて管理する。
 * デッキやミキサーの「機能」には関与せず、あくまで箱としての舞台を作る役割。
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly orbitControls: OrbitControls;
  readonly composer: EffectComposer;
  readonly clock = new THREE.Clock();

  readonly woofers: Woofer[] = [];

  constructor() {
    this.camera = new THREE.PerspectiveCamera(18, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(-80, 70, 130);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    document.body.appendChild(this.renderer.domElement);

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2.1; // 床に潜り込むのを防止

    this.scene.background = new THREE.Color(0x010103);
    this.scene.fog = new THREE.Fog(0x010103, 150, 400);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 0.85);
    this.composer.addPass(bloom);

    this.createLighting();
    this.createFloor();
    this.createChassis();
    this.createFurniture();
    this.createBackgroundCable();

    window.addEventListener('resize', this.onResize);
  }

  private createLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.15));

    const topLight = new THREE.RectAreaLight(0xffffff, 2, 100, 100);
    topLight.position.set(0, 50, 20);
    topLight.lookAt(0, 0, 0);
    this.scene.add(topLight);

    const addNeonSpot = (x: number, z: number, color: number) => {
      const p = new THREE.PointLight(color, 40, 60);
      p.position.set(x, 15, z);
      this.scene.add(p);
    };
    addNeonSpot(-45, -10, 0x00f2ff);
    addNeonSpot(45, -10, 0xff007b);
  }

  private createFloor() {
    const grid = new THREE.GridHelper(1000, 50, 0x222222, 0x111111);
    grid.position.y = -17.4;
    this.scene.add(grid);
  }

  private createChassis() {
    const bodyGeo = new THREE.BoxGeometry(45, 4, 30);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 1, roughness: 0.2 });
    this.scene.add(new THREE.Mesh(bodyGeo, bodyMat));

    const sideGeo = new THREE.BoxGeometry(1, 4.2, 30.2);
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.1 });
    const sideL = new THREE.Mesh(sideGeo, sideMat);
    sideL.position.x = -22.5;
    const sideR = sideL.clone();
    sideR.position.x = 22.5;
    this.scene.add(sideL, sideR);
  }

  private createFurniture() {
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.9, roughness: 0.05 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(130, 2, 65), deskMat);
    top.position.y = -2;
    this.scene.add(top);

    this.addSpeaker(-45, 0x00f2ff);
    this.addSpeaker(45, 0xff007b);
  }

  /**
   * KS DIGITAL C5-Reference を意識した2ウェイ・スタジオモニター風の見た目。
   * 台形気味の筐体+小口径ツイーター+ウーファーという構成にして、
   * 単なる「箱にコーン」だったものよりモニタースピーカーらしい質感にする。
   */
  private addSpeaker(x: number, color: number) {
    const group = new THREE.Group();
    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, metalness: 0.5, roughness: 0.4 });

    // 前面がわずかに絞られた台形筐体(スタジオモニターらしいバッフル形状の簡易近似)
    const cabinetGeo = new THREE.CylinderGeometry(7.4, 8.4, 28, 4, 1);
    const box = new THREE.Mesh(cabinetGeo, cabinetMat);
    box.rotation.y = Math.PI / 4; // 四角柱として使うため45度回転
    group.add(box);

    const baffleMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 });
    const baffle = new THREE.Mesh(new THREE.BoxGeometry(15.6, 27, 0.6), baffleMat);
    baffle.position.z = 7.9;
    group.add(baffle);

    // ツイーター(小口径・上部)
    const tweeter = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 1.2, 32),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.2 })
    );
    tweeter.rotation.x = Math.PI / 2;
    tweeter.position.set(0, 8, 8.3);
    group.add(tweeter);

    const tweeterDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 })
    );
    tweeterDome.rotation.x = -Math.PI / 2;
    tweeterDome.position.set(0, 8, 8.9);
    group.add(tweeterDome);

    // ウーファー(大口径・下部)
    const wGeo = new THREE.CylinderGeometry(6, 6, 2, 32);
    const wMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.3 });
    const woofer = new THREE.Mesh(wGeo, wMat);
    woofer.rotation.x = Math.PI / 2;
    woofer.position.set(0, -5, 7.5);
    group.add(woofer);
    this.woofers.push({ mesh: woofer, initialZ: 7.5 });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.2, 16, 64), new THREE.MeshBasicMaterial({ color }));
    ring.position.set(0, -5, 8.1);
    group.add(ring);

    // ブランドロゴ代わりの小さな発光バー(ブランディング用のアクセント)
    const badge = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.1), new THREE.MeshBasicMaterial({ color }));
    badge.position.set(0, -11.5, 8.2);
    group.add(badge);

    group.position.set(x, 12, -15);
    group.lookAt(0, 5, 50); // ブース中央側に向けているだけの簡易処理
    this.scene.add(group);
  }

  private createBackgroundCable() {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-40, 0, -5),
      new THREE.Vector3(-55, -15, -15),
      new THREE.Vector3(0, -18, -40),
      new THREE.Vector3(55, -15, -15),
      new THREE.Vector3(40, 0, -5),
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.3, 8, false), new THREE.MeshStandardMaterial({ color: 0x050505 }));
    this.scene.add(cable);
  }

  /** 曲のキック(低音)に合わせてウーファーを前後に動かす */
  updateWoofers(beat: number) {
    this.woofers.forEach(w => (w.mesh.position.z = w.initialZ + beat * 1.5));
  }

  render() {
    this.orbitControls.update();
    this.composer.render();
  }

  private onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };
}
