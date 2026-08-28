import { SceneManager } from './core/SceneManager';
import { DeckAudioEngine } from './audio/DeckAudioEngine';
import { MixerEngine } from './audio/MixerEngine';
import { Deck } from './components/Deck';
import { Mixer } from './components/Mixer';
import { Monitors } from './components/Monitors';
import { ControlPanel } from './ui/ControlPanel';
import { InteractionManager } from './interaction/InteractionManager';

class CyberStudioPro {
  private sceneManager = new SceneManager();
  private audioCtx = new AudioContext();

  private engineA = new DeckAudioEngine('A', this.audioCtx);
  private engineB = new DeckAudioEngine('B', this.audioCtx);
  private mixerEngine = new MixerEngine(this.audioCtx, this.engineA, this.engineB);

  private deckA = new Deck(this.engineA, this.sceneManager.scene, -11, 0x00f2ff);
  private deckB = new Deck(this.engineB, this.sceneManager.scene, 11, 0xff007b);
  private mixer = new Mixer(this.sceneManager.scene, this.mixerEngine, this.engineA, this.engineB);
  private monitors = new Monitors(this.sceneManager.scene, this.engineA, this.engineB);

  private interaction = new InteractionManager(
    this.sceneManager.renderer,
    this.sceneManager.camera,
    this.sceneManager.orbitControls
  );

  constructor() {
    this.interaction.register(this.deckA.controls);
    this.interaction.register(this.deckB.controls);
    this.interaction.register(this.mixer.controls);

    new ControlPanel(this.engineA, this.engineB);
    this.setupHotCueKeyboard();
    this.animate();
  }

  /** 1-8: デッキAのホットキュー / QWERTYUI: デッキBのホットキュー。Shiftでクリア */
  private setupHotCueKeyboard() {
    const deckBKeys = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i'];
    window.addEventListener('keydown', (e) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 8) {
        this.deckA.triggerPad(num - 1, e.shiftKey);
        return;
      }
      const idx = deckBKeys.indexOf(e.key.toLowerCase());
      if (idx !== -1) this.deckB.triggerPad(idx, e.shiftKey);
    });
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const elapsed = this.sceneManager.clock.getElapsedTime();

    this.deckA.update(elapsed, 0);
    this.deckB.update(elapsed, 1);
    this.mixer.update(elapsed);
    this.monitors.update(elapsed);
    this.interaction.updateVisuals();

    // どちらか強い方の低音をキックとしてウーファーを揺らす
    const beatA = this.engineA.isLoaded ? Math.pow(this.engineA.getAudioLevel(0, 8), 2) : Math.pow(Math.sin(elapsed * 6.7), 10) * 0.5;
    const beatB = this.engineB.isLoaded ? Math.pow(this.engineB.getAudioLevel(0, 8), 2) : 0;
    this.sceneManager.updateWoofers(Math.max(beatA, beatB));

    this.sceneManager.render();
  };
}

new CyberStudioPro();
