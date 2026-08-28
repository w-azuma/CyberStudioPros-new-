import type { DeckAudioEngine } from '../audio/DeckAudioEngine';

/**
 * 3D空間でのドラッグ操作だけに頼ると誤操作が多いため、
 * 曲の読み込み・再生/一時停止・キュー・シンクといった
 * 「絶対に外したくない」操作はシンプルなHTMLオーバーレイで提供する。
 * EQやピッチ、ホットキューなど質感重視の操作は3Dコントロール側に任せる住み分け。
 */
export class ControlPanel {
  constructor(deckA: DeckAudioEngine, deckB: DeckAudioEngine) {
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'top:16px', 'left:0', 'width:100%',
      'display:flex', 'justify-content:space-between', 'padding:0 32px',
      'box-sizing:border-box', 'font-family:sans-serif', 'z-index:10', 'pointer-events:none',
    ].join(';');

    root.appendChild(this.buildDeckPanel(deckA, deckB, 'A', 0x00f2ff, 'flex-start'));
    root.appendChild(this.buildDeckPanel(deckB, deckA, 'B', 0xff007b, 'flex-end'));
    document.body.appendChild(root);
  }

  private buildDeckPanel(engine: DeckAudioEngine, otherEngine: DeckAudioEngine, label: string, color: number, align: string): HTMLElement {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex;flex-direction:column;align-items:${align};gap:6px;pointer-events:auto;`;

    const title = document.createElement('div');
    title.textContent = `DECK ${label}`;
    title.style.cssText = `color:${hex};font-size:12px;letter-spacing:2px;`;
    wrap.appendChild(title);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.cssText = 'color:#fff;font-size:11px;max-width:130px;';
    fileInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) engine.loadFile(file);
    });

    const mkButton = (text: string, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.style.cssText = `background:#0a0a0a;color:${hex};border:1px solid ${hex};padding:4px 10px;font-size:11px;cursor:pointer;letter-spacing:1px;`;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const playBtn = mkButton('PLAY', () => engine.togglePlay());
    const cueBtn = mkButton('CUE', () => engine.pressCue());
    const syncBtn = mkButton('SYNC', () => engine.syncTo(otherEngine.effectiveBpm));

    row.append(fileInput, playBtn, cueBtn, syncBtn);
    wrap.appendChild(row);

    const hint = document.createElement('div');
    hint.textContent = label === 'A' ? 'HOTCUE: 1-8 (Shift+クリックで解除)' : 'HOTCUE: Q W E R T Y U I (Shift+クリックで解除)';
    hint.style.cssText = 'color:#666;font-size:10px;';
    wrap.appendChild(hint);

    return wrap;
  }
}
