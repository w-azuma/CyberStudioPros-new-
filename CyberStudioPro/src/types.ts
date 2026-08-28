import * as THREE from 'three';

export type DeckId = 'A' | 'B';

/** ホットキュー1個分。秒数が入っていれば「セット済み」、nullなら未セット */
export interface HotCue {
  time: number | null;
}

/** ノブ/フェーダーなど、ドラッグで値を変える3Dコントロールの共通インターフェース。
 *  InteractionManager はこの形さえ満たしていれば中身を知らなくても操作できる。 */
export interface DraggableControl {
  /** レイキャストの当たり判定に使うメッシュ */
  object3D: THREE.Object3D;
  /** ドラッグを検出する軸。縦フェーダー/ノブは 'y'、クロスフェーダーは 'x' */
  axis: 'x' | 'y';
  /** ドラッグ量(スクリーンpx)を受け取って値に反映する */
  onDrag(deltaPx: number): void;
  /** クリックのみ(ドラッグ量が閾値以下)の場合に呼ばれる。パッドや再生トグルなど */
  onClick?(shiftKey: boolean): void;
  /** ドラッグの有無にかかわらず、掴んでいたポインターを離した時に呼ばれる(スクラッチ解除など) */
  onRelease?(): void;
  /** 現在値をメッシュの見た目(位置・回転・発光など)に反映する。毎フレーム呼ばれる */
  syncVisual(): void;
}

export interface DeckColor {
  primary: number;
}
