import Phaser from 'phaser';
import { cellAt } from '../core/board';
import { MATCH_LENGTH } from '../core/match';
import type { BoardState, Uid } from '../core/types';
import type { Hint } from '../core/solver';
import { hexToInt, mixColors } from '../data/colors';
import { ITEM_IDS, getItem } from '../data/items';
import { decorPreset, type DecorPreset } from '../data/shop';
import { useGameStore, type Phase } from '../store/gameStore';
import { audio } from './audio';
import { COMBO_START, comboLabel } from '../core/combo';
import { leftoverTypes } from '../core/boosters';
import {
  burst,
  confetti,
  ensureFxTextures,
  ensureIceTexture,
  explosion,
  flash,
  floatText,
  iceTextureKey,
  landing,
  pop,
  praiseText,
  rain,
  shake,
  shine,
  trail,
  vignette,
} from './effects';
import { motionScale, panFor, swayAngle } from './juice';
import { ensureItemTextures, itemTextureKey, itemTextureNeeds, type TileVariant } from './iconPainter';
import {
  boardOuterRect,
  cellBox,
  cellIndexAt,
  computeShelfLayout,
  shelfRect,
  type LayoutInsets,
  type ShelfLayout,
} from './layout';

const DEFAULT_INSETS: LayoutInsets = { top: 132, bottom: 112 };
const DRAG_THRESHOLD = 8;
/** Spark colour of golden products. */
const GOLDEN_SPARK = '#ffd76a';

interface DragState {
  uid: Uid;
  from: number;
  sprite: Phaser.GameObjects.Image;
  startX: number;
  startY: number;
  active: boolean;
  /** Soft ellipse under the lifted product — sells the "picked up" pose. */
  shadow: Phaser.GameObjects.Ellipse | null;
  /** Last horizontal positions, for the tilt and the direction of the drag. */
  lastX: number;
  lastAt: number;
}

export class GameScene extends Phaser.Scene {
  static readonly KEY = 'GameScene';

  private decor!: Phaser.GameObjects.Graphics;
  private uiLayer!: Phaser.GameObjects.Graphics;

  private layout!: ShelfLayout;
  private items = new Map<Uid, Phaser.GameObjects.Image>();
  private moveTweens = new Map<Uid, Phaser.Tweens.Tween>();
  /**
   * The endless "breathing" tween of golden / bomb products. It is tracked
   * separately, because a drag has to pause it (the finger drives the angle)
   * and a drop has to bring it back — killing every tween of a sprite would
   * silently stop the animated skin forever.
   */
  private idleTweens = new Map<Uid, Phaser.Tweens.Tween>();
  /** Icy overlays, keyed by cell index (ice belongs to the cell, not the item). */
  private ice = new Map<number, Phaser.GameObjects.Image>();
  private processedMove: unknown = null;

  private renderedBoard: BoardState | null = null;
  private renderedHint: Hint | null = null;
  private renderedPhase: Phase = 'menu';
  private renderedSelection: number | null = null;

  private selection: number | null = null;
  private drag: DragState | null = null;
  private pulse = 0;
  /** Last time a drag trail spark was spawned (throttled per frame count). */
  private trailAt = 0;
  private streak = 0;
  private streakTimer = 0;
  private celebrationDone = false;
  private decorId = '';
  private frozenHintAt = 0;
  private processedBooster: unknown = null;

  constructor() {
    super(GameScene.KEY);
  }

  create(): void {
    ensureItemTextures(this, ITEM_IDS);
    ensureFxTextures(this);
    ensureIceTexture(this);

    // Item sprites live on the scene display list so that `depth` sorting works
    // (children of a Container would ignore their own depth).
    this.decor = this.add.graphics().setDepth(0);
    this.uiLayer = this.add.graphics().setDepth(20);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    this.layout = this.buildLayout(1, 1);
  }

  private onShutdown(): void {
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  private onResize(): void {
    const board = this.renderedBoard;
    if (!board) return;
    this.relayout(board, false);
  }

  /**
   * Re-measures the HUD and rebuilds the shelf geometry. Called on resize and
   * shortly after a level starts (the DOM HUD may not have been painted yet).
   */
  private relayout(board: BoardState, animate: boolean, force = false): void {
    const next = this.buildLayout(board.rows, board.cols);
    const same =
      Math.abs(next.originY - this.layout.originY) < 1 &&
      Math.abs(next.cellSize - this.layout.cellSize) < 0.5 &&
      Math.abs(next.originX - this.layout.originX) < 1;
    if (same && !force) return;

    this.layout = next;
    this.drawDecor(board);
    this.syncBoard(board, animate);
  }

  /** The HUD is DOM, so its real size is measured instead of guessed. */
  private measureInsets(): LayoutInsets {
    if (typeof document === 'undefined') return DEFAULT_INSETS;
    const top = document.querySelector('[data-hud="top"]');
    const bottom = document.querySelector('[data-hud="bottom"]');
    const topHeight = top?.getBoundingClientRect().height ?? 0;
    const bottomHeight = bottom?.getBoundingClientRect().height ?? 0;
    return {
      top: topHeight > 40 ? topHeight + 12 : DEFAULT_INSETS.top,
      bottom: bottomHeight > 40 ? bottomHeight + 12 : DEFAULT_INSETS.bottom,
    };
  }

  private buildLayout(rows: number, cols: number): ShelfLayout {
    const width = this.scale.width;
    const height = this.scale.height;
    return computeShelfLayout({ rows, cols, width, height, insets: this.measureInsets() });
  }

  // ---------------------------------------------------------------- rendering

  private rebuild(board: BoardState): void {
    this.layout = this.buildLayout(board.rows, board.cols);

    for (const sprite of this.items.values()) sprite.destroy();
    this.items.clear();
    for (const overlay of this.ice.values()) overlay.destroy();
    this.ice.clear();
    this.moveTweens.forEach((tween) => tween.stop());
    this.moveTweens.clear();
    this.idleTweens.forEach((tween) => tween.stop());
    this.idleTweens.clear();
    this.renderedBoard = null;
    this.drawDecor(board);
    this.syncBoard(board, true);

    // The HUD is DOM: it may only be measured after React painted it.
    this.time.delayedCall(160, () => {
      const current = this.renderedBoard;
      if (current) this.relayout(current, false);
    });
  }

  /** Current interior preset (bought in the shop). */
  private decor_(): DecorPreset {
    if (this.decorId === '') this.decorId = useGameStore.getState().progress.activeDecor;
    return decorPreset(this.decorId);
  }

  private drawWall(preset: DecorPreset): void {
    const { width, height } = this.scale;
    const bands = 28;

    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      this.decor.fillStyle(hexToInt(mixColors(preset.wallTop, preset.wallBottom, t)), 1);
      this.decor.fillRect(0, (height * i) / bands, width, height / bands + 1);
    }
  }

  private drawDecor(board: BoardState): void {
    const g = this.decor;
    const preset = this.decor_();
    g.clear();
    this.drawWall(preset);

    const outer = boardOuterRect(this.layout);
    const rounded = Math.min(30, this.layout.cellSize * 0.35);

    g.fillStyle(hexToInt('#000000'), 0.16);
    g.fillRoundedRect(outer.x + 6, outer.y + 10, outer.width, outer.height, rounded);
    g.fillStyle(hexToInt(preset.caseLight), 0.85);
    g.fillRoundedRect(outer.x, outer.y, outer.width, outer.height, rounded);

    // bookcase sides
    g.fillStyle(hexToInt(preset.caseColor), 1);
    g.fillRoundedRect(outer.x - 2, outer.y - 2, this.layout.sideWidth, outer.height + 4, 10);
    g.fillRoundedRect(outer.x + outer.width - this.layout.sideWidth + 2, outer.y - 2, this.layout.sideWidth, outer.height + 4, 10);
    g.fillStyle(hexToInt('#ffffff'), 0.18);
    g.fillRoundedRect(outer.x - 2, outer.y - 2, this.layout.sideWidth * 0.4, outer.height + 4, 6);
    g.fillRoundedRect(
      outer.x + outer.width - this.layout.sideWidth * 0.6 + 2,
      outer.y - 2,
      this.layout.sideWidth * 0.4,
      outer.height + 4,
      6,
    );

    const pad = this.layout.cellSize * 0.09;

    for (let row = 0; row < board.rows; row += 1) {
      const shelf = shelfRect(this.layout, row);
      g.fillStyle(hexToInt('#000000'), 0.24);
      g.fillRoundedRect(shelf.x - pad, shelf.y + 4, shelf.width + pad * 2, shelf.height, shelf.height / 2);
      g.fillStyle(hexToInt(preset.plank), 1);
      g.fillRoundedRect(shelf.x - pad, shelf.y, shelf.width + pad * 2, shelf.height, shelf.height / 2);
      g.fillStyle(hexToInt(preset.plankLight), 1);
      g.fillRoundedRect(shelf.x - pad, shelf.y, shelf.width + pad * 2, shelf.height * 0.45, shelf.height / 3);
    }

    for (let index = 0; index < board.cells.length; index += 1) {
      const box = cellBox(this.layout, index);
      const cell = board.cells[index];
      const radius = this.layout.cellSize * 0.24;
      const inset = this.layout.cellSize * 0.06;

      if (cell?.locked) {
        g.fillStyle(hexToInt(preset.blocked), 0.6);
        g.fillRoundedRect(box.x + inset, box.y + inset, box.size - inset * 2, box.size - inset * 2, radius);
        // padlock
        const cx = box.cx;
        const cy = box.cy;
        const w = box.size * 0.3;
        g.lineStyle(box.size * 0.045, hexToInt('#e6c9a2'), 0.95);
        g.beginPath();
        g.arc(cx, cy - box.size * 0.1, w * 0.5, Math.PI, Math.PI * 2, false);
        g.strokePath();
        g.fillStyle(hexToInt('#e6c9a2'), 0.95);
        g.fillRoundedRect(cx - w * 0.65, cy - box.size * 0.1, w * 1.3, w * 1.05, w * 0.25);
        continue;
      }

      g.fillStyle(hexToInt(preset.well), 0.14);
      g.fillRoundedRect(box.x + inset, box.y + inset, box.size - inset * 2, box.size - inset * 2, radius);
    }
  }

  private createItemSprite(
    type: string,
    uid: Uid,
    index: number,
    animate: boolean,
    variant: TileVariant,
  ): Phaser.GameObjects.Image {
    const box = cellBox(this.layout, index);
    const sprite = this.add.image(box.cx, box.cy, this.itemTexture(type, variant));
    sprite.setData('type', type);
    sprite.setDisplaySize(box.size * 1.02, box.size * 1.02);
    sprite.setAngle(Phaser.Math.Between(-3, 3));
    sprite.setDepth(11);
    this.items.set(uid, sprite);

    if (variant !== 'plain') this.startIdlePulse(uid, sprite);

    if (animate) {
      const delay = index * 16;
      sprite.setScale(0.1);
      sprite.setAlpha(0);
      this.tweens.add({
        targets: sprite,
        scale: (box.size * 1.02) / sprite.width,
        alpha: 1,
        delay,
        duration: 320,
        ease: 'Back.easeOut',
      });
    }

    return sprite;
  }

  /** Gentle breathing of a special product — paused while it is dragged. */
  private startIdlePulse(uid: Uid, sprite: Phaser.GameObjects.Image): void {
    this.idleTweens.get(uid)?.stop();
    const tween = this.tweens.add({
      targets: sprite,
      angle: sprite.angle + 5,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.idleTweens.set(uid, tween);
  }

  /**
   * Creates the tile skins the current board needs. This lives here (and not in
   * `rebuild`) because sprites are also created when only the contents change —
   * for example on a golden level whose shelf size matches the previous level.
   */
  private ensureBoardTextures(board: BoardState): void {
    const needs = itemTextureNeeds(board.cells);
    if (needs.ids.length === 0) return;
    ensureItemTextures(this, needs.ids, needs.variants);
  }

  /** Texture key for a product, falling back to the plain tile if a skin is missing. */
  private itemTexture(type: string, variant: TileVariant): string {
    const wanted = itemTextureKey(type, variant);
    if (this.textures.exists(wanted)) return wanted;
    return itemTextureKey(type);
  }

  private syncBoard(board: BoardState, animate: boolean): void {
    this.ensureBoardTextures(board);

    const alive = new Set<Uid>();
    const clearedSprites: Phaser.GameObjects.Image[] = [];

    for (let index = 0; index < board.cells.length; index += 1) {
      const cell = cellAt(board, index);
      if (cell.uid === null || cell.type === null) continue;
      alive.add(cell.uid);

      const box = cellBox(this.layout, index);
      let sprite = this.items.get(cell.uid);

      const variant: TileVariant =
        cell.special === 'golden' ? 'golden' : cell.special === 'bomb' ? 'bomb' : 'plain';

      if (!sprite) {
        sprite = this.createItemSprite(cell.type, cell.uid, index, animate, variant);
        continue;
      }

      const textureKey = this.itemTexture(cell.type, variant);
      if (sprite.texture.key !== textureKey) {
        sprite.setTexture(textureKey);
        sprite.setData('type', cell.type);
      }
      sprite.setDisplaySize(box.size * 1.02, box.size * 1.02);

      if (this.drag?.uid === cell.uid) continue;
      if (Math.abs(sprite.x - box.cx) < 0.5 && Math.abs(sprite.y - box.cy) < 0.5) continue;

      this.moveTweens.get(cell.uid)?.stop();
      const tween = this.tweens.add({
        targets: sprite,
        x: box.cx,
        y: box.cy,
        duration: animate ? 170 : 0,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.moveTweens.delete(cell.uid as Uid);
          if (animate) landing(this, sprite, box.size);
        },
      });
      this.moveTweens.set(cell.uid, tween);
    }

    for (const [uid, sprite] of [...this.items]) {
      if (alive.has(uid)) continue;
      this.items.delete(uid);
      this.idleTweens.delete(uid);
      this.moveTweens.get(uid)?.stop();
      this.moveTweens.delete(uid);
      clearedSprites.push(sprite);
    }

    if (clearedSprites.length > 0) this.playClearEffects(clearedSprites);

    this.syncIce(board);
    this.renderedBoard = board;
  }

  /** Adds / removes the icy overlays and animates the ones that melted away. */
  private syncIce(board: BoardState): void {
    const wanted = new Set<number>();

    for (let index = 0; index < board.cells.length; index += 1) {
      const cell = cellAt(board, index);
      if (!cell.frozen) continue;
      wanted.add(index);

      if (this.ice.has(index)) continue;
      const box = cellBox(this.layout, index);
      const overlay = this.add.image(box.cx, box.cy, iceTextureKey());
      overlay.setDisplaySize(box.size * 1.04, box.size * 1.04);
      overlay.setDepth(13);
      overlay.setAlpha(0);
      this.tweens.add({ targets: overlay, alpha: 0.95, duration: 220 });
      this.ice.set(index, overlay);
    }

    for (const [index, overlay] of [...this.ice]) {
      if (wanted.has(index)) continue;
      this.ice.delete(index);
      const { x, y } = overlay;
      burst(this, x, y, '#dff2ff', 12);
      audio.iceMelt(this.panOf(x));
      this.tweens.killTweensOf(overlay);
      this.tweens.add({
        targets: overlay,
        alpha: 0,
        scale: overlay.scale * 0.6,
        duration: 320,
        ease: 'Cubic.easeIn',
        onComplete: () => overlay.destroy(),
      });
    }
  }

  /** One explosion per bomb blast, aimed at the cells the blast emptied. */
  private playBlast(blast: { type: string; indices: number[] }): void {
    audio.boom();
    if (motionScale() >= 1) this.cameras.main.shake(220, 0.006);

    for (const index of blast.indices) {
      const box = cellBox(this.layout, index);
      explosion(this, box.cx, box.cy, box.size);
    }

    const first = blast.indices[0];
    if (first !== undefined) {
      const box = cellBox(this.layout, first);
      floatText(this, box.cx, box.cy - 20, 'Бум!', '#ffd76a');
    }
    this.streak += 1;
    this.streakTimer = this.time.now + 2600;
  }

  private playClearEffects(sprites: Phaser.GameObjects.Image[]): void {
    const first = sprites[0];
    let sawGolden = false;

    for (const sprite of sprites) {
      const type = this.typeOfSprite(sprite);
      const accent = type ? getItem(type).accent : '#ffffff';
      const isGolden = sprite.texture.key.endsWith('-golden');
      sawGolden = sawGolden || isGolden;
      burst(this, sprite.x, sprite.y, isGolden ? GOLDEN_SPARK : accent, isGolden ? 22 : 12);
      if (isGolden) {
        shine(this, sprite.x, sprite.y, sprite.displayWidth);
        audio.golden(this.panOf(sprite.x));
      }
      // the golden idle pulse must not fight the removal animation
      this.tweens.killTweensOf(sprite);
      this.tweens.add({
        targets: sprite,
        scale: sprite.scale * 0.2,
        alpha: 0,
        angle: sprite.angle + Phaser.Math.Between(-25, 25),
        duration: 220,
        ease: 'Cubic.easeIn',
        onComplete: () => sprite.destroy(),
      });
    }

    if (sawGolden && first) {
      floatText(this, first.x, first.y - 34, '+1 ход', '#ffd76a');
      burst(this, first.x, first.y, GOLDEN_SPARK, 10);
    }

    if (first && sprites.length >= MATCH_LENGTH) {
      const type = this.typeOfSprite(first);
      const accent = type ? getItem(type).accent : '#ffffff';
      floatText(this, first.x, first.y - 10, praiseText(this.streak), '#fff8e7');
      pop(this, first, accent);
      audio.match(this.streak, this.panOf(first.x));
      this.streak += 1;
      this.streakTimer = this.time.now + 2600;
    }
  }

  /** Visuals for a booster: impact, swirl or a floating "+3 хода". */
  private playBooster(id: string, index: number): void {
    const board = this.renderedBoard;

    if (id === 'hammer' && index >= 0 && board) {
      const box = cellBox(this.layout, index);
      const type = board.cells[index]?.type ?? null;
      const accent = type ? getItem(type).accent : '#ffffff';

      burst(this, box.cx, box.cy, accent, 18);
      burst(this, box.cx, box.cy, '#ffe9a3', 10);
      floatText(this, box.cx, box.cy - 26, '💥', '#ffd76a');
      this.cameras.main.shake(140, 0.004);
      audio.boom();

      const leftovers = board ? leftoverTypes(board) : [];
      const mine = type ? leftovers.find((entry) => entry.type === type) : undefined;
      if (mine) {
        const box2 = cellBox(this.layout, index);
        floatText(this, box2.cx, box2.cy + 26, 'остаток не собрать', '#dff2ff');
      }
      return;
    }

    if (id === 'shuffle') {
      audio.sparkle();
      const centre = this.layout;
      for (const sprite of this.items.values()) {
        burst(this, sprite.x, sprite.y, '#dff2ff', 3);
      }
      floatText(this, centre.originX + centre.cellSize * 3, centre.originY + 20, 'Перемешано', '#dff2ff');
      return;
    }

    if (id === 'extraMove') {
      audio.sparkle();
      floatText(this, this.scale.width / 2, 160, '+3 хода', '#7ed957');
      return;
    }

    if (id === 'undo') {
      audio.tap();
      floatText(this, this.scale.width / 2, 160, '+1 отмена', '#dff2ff');
    }
  }

  /** Floating combo call-out above the cell the move ended on. */
  private playCombo(streak: number, coins: number, index: number): void {
    const label = comboLabel(streak);
    if (!label) return;

    const box = cellBox(this.layout, index);
    const colour = streak >= 6 ? '#ff9f43' : streak >= 4 ? '#ffd76a' : '#ffe9a3';

    floatText(this, box.cx, box.cy - 34, label, colour);
    if (coins > 0) floatText(this, box.cx, box.cy - 62, `+${coins}`, '#fff3c4');
    burst(this, box.cx, box.cy, colour, Math.min(26, 10 + streak * 3));
    // The higher the streak, the wider the glow around the board — a combo is
    // felt before the counter is read.
    if (streak >= 4) vignette(this, colour, streak);
    audio.sparkle(this.panOf(box.cx));
    this.streak = streak;
    this.streakTimer = this.time.now + 2600;
  }

  private typeOfSprite(sprite: Phaser.GameObjects.Image): string | null {
    const type = sprite.getData('type') as string | undefined;
    if (type) return type;
    const key = sprite.texture.key;
    if (!key.startsWith('item-')) return null;
    const rest = key.slice(5);
    return rest.endsWith('-golden') ? rest.slice(0, -'-golden'.length) : rest;
  }

  // ------------------------------------------------------------------ overlays

  private drawOverlays(hint: Hint | null): void {
    const g = this.uiLayer;
    g.clear();
    const state = useGameStore.getState();
    const board = state.runtime?.board;
    if (!board) return;

    const radius = this.layout.cellSize * 0.26;
    const inset = this.layout.cellSize * 0.04;

    if (this.selection !== null) {
      const box = cellBox(this.layout, this.selection);
      g.lineStyle(4, hexToInt('#f6a23c'), 0.95);
      g.strokeRoundedRect(box.x + inset, box.y + inset, box.size - inset * 2, box.size - inset * 2, radius);

      const pulse = 0.35 + 0.3 * Math.sin(this.pulse * 2.2);
      for (let index = 0; index < board.cells.length; index += 1) {
        const cell = cellAt(board, index);
        if (cell.locked || cell.uid !== null) continue;
        const target = cellBox(this.layout, index);
        g.lineStyle(3, hexToInt('#4caf50'), pulse);
        g.strokeRoundedRect(target.x + inset, target.y + inset, target.size - inset * 2, target.size - inset * 2, radius);
      }
    }

    // Hammer armed: every product on the shelves is a possible target.
    if (state.boosterMode === 'hammer') {
      const pulse = 0.35 + 0.35 * Math.sin(this.pulse * 3.4);
      for (let index = 0; index < board.cells.length; index += 1) {
        const cell = cellAt(board, index);
        if (cell.locked || cell.uid === null) continue;
        const box = cellBox(this.layout, index);
        g.lineStyle(4, hexToInt('#ff7a3d'), pulse);
        g.strokeRoundedRect(box.x + inset, box.y + inset, box.size - inset * 2, box.size - inset * 2, radius);
      }
    }

    if (hint) {
      const from = cellBox(this.layout, hint.from);
      const to = cellBox(this.layout, hint.to);
      const pulse = 0.5 + 0.5 * Math.sin(this.pulse * 3);

      g.lineStyle(5, hexToInt('#f6c445'), 0.6 + 0.35 * pulse);
      g.strokeRoundedRect(from.x + inset, from.y + inset, from.size - inset * 2, from.size - inset * 2, radius);
      g.lineStyle(5, hexToInt('#4caf50'), 0.55 + 0.4 * pulse);
      g.strokeRoundedRect(to.x + inset, to.y + inset, to.size - inset * 2, to.size - inset * 2, radius);

      const angle = Math.atan2(to.cy - from.cy, to.cx - from.cx);
      const startX = from.cx + Math.cos(angle) * from.size * 0.45;
      const startY = from.cy + Math.sin(angle) * from.size * 0.45;
      const endX = to.cx - Math.cos(angle) * to.size * 0.5;
      const endY = to.cy - Math.sin(angle) * to.size * 0.5;
      g.lineStyle(4, hexToInt('#4caf50'), 0.8);
      g.lineBetween(startX, startY, endX, endY);
      g.fillStyle(hexToInt('#4caf50'), 0.9);
      g.fillCircle(endX, endY, this.layout.cellSize * 0.09);
    }
  }

  private shakeCell(index: number): void {
    const box = cellBox(this.layout, index);
    const ring = this.add.rectangle(box.cx, box.cy, box.size, box.size, 0xd84343, 0.25);
    ring.setDepth(19);
    shake(this, ring, box.size * 0.06);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      duration: 260,
      onComplete: () => ring.destroy(),
    });
  }

  // -------------------------------------------------------------------- input

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const state = useGameStore.getState();
    if (state.phase !== 'playing' || !state.runtime || this.drag) return;

    const index = cellIndexAt(this.layout, pointer.worldX, pointer.worldY, this.layout.cellSize * 0.1);
    if (index === null) {
      this.clearSelection();
      return;
    }

    // The hammer is armed: the next tap chooses what it destroys.
    if (state.boosterMode === 'hammer') {
      const cell = cellAt(state.runtime.board, index);
      if (cell.uid === null) {
        audio.invalid();
        this.shakeCell(index);
        return;
      }
      this.clearSelection();
      useGameStore.getState().useBooster('hammer', index);
      return;
    }

    const board = state.runtime.board;
    const cell = cellAt(board, index);
    const selectedFrom = this.selection;

    if (selectedFrom !== null && selectedFrom !== index) {
      const selected = cellAt(board, selectedFrom);
      this.clearSelection();

      // tap-to-move: the second tap sends the selected product into this cell
      if (selected.uid !== null && cell.uid === null && !cell.locked) {
        this.tryMove(selectedFrom, index);
        return;
      }
    }

    if (cell.locked) {
      audio.invalid();
      this.shakeCell(index);
      return;
    }

    if (cell.frozen) {
      // Ice pins the product: it can only be matched in place.
      audio.invalid();
      this.shakeCell(index);
      this.renderIceHint();
      return;
    }

    if (cell.uid === null) {
      this.clearSelection();
      return;
    }

    const sprite = this.items.get(cell.uid);
    if (!sprite) return;
    const box2 = cellBox(this.layout, index);

    const shadow = this.add.ellipse(box2.cx, box2.cy + this.layout.cellSize * 0.3, this.layout.cellSize * 0.7, this.layout.cellSize * 0.26, 0x000000, 0.28);
    shadow.setDepth(10);
    shadow.setVisible(false);

    this.drag = {
      uid: cell.uid,
      from: index,
      sprite,
      startX: pointer.worldX,
      startY: pointer.worldY,
      active: false,
      shadow,
      lastX: pointer.worldX,
      lastAt: this.time.now,
    };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag) return;

    if (!drag.active) {
      const distance = Math.hypot(pointer.worldX - drag.startX, pointer.worldY - drag.startY);
      if (distance < DRAG_THRESHOLD) return;
      drag.active = true;
      // the product may still be flying to its cell — the finger wins
      this.moveTweens.get(drag.uid)?.stop();
      this.moveTweens.delete(drag.uid);
      drag.sprite.setDepth(50);
      drag.shadow?.setVisible(true);
      // The finger owns the angle now; the idle pulse comes back after the drop.
      if (this.idleTweens.delete(drag.uid)) this.tweens.killTweensOf(drag.sprite);
      this.tweens.add({
        targets: drag.sprite,
        scaleX: drag.sprite.scale * 1.16,
        scaleY: drag.sprite.scale * 1.06,
        duration: 130,
        ease: 'Back.easeOut',
      });
      audio.pickup(this.panOf(drag.sprite.x));
    }

    const lift = this.layout.cellSize * 0.16;
    drag.sprite.setPosition(pointer.worldX, pointer.worldY - lift);

    // Tilt follows the finger: the product leans into the direction it is
    // dragged, which reads as weight.
    const elapsed = Math.max(1, this.time.now - drag.lastAt);
    const vx = (pointer.worldX - drag.lastX) / (elapsed / 16.7);
    drag.lastX = pointer.worldX;
    drag.lastAt = this.time.now;
    drag.sprite.setAngle(swayAngle(vx));

    // Shadow stays on the shelf under the product and gets softer with height.
    drag.shadow?.setPosition(pointer.worldX, pointer.worldY + lift * 0.55);
    drag.shadow?.setScale(1 - Math.min(0.35, Math.abs(drag.sprite.angle) * 0.02));

    // Light trail: one soft spark every few frames, coloured like the product.
    if (this.time.now - this.trailAt > 55) {
      this.trailAt = this.time.now;
      const type = this.typeOfSprite(drag.sprite);
      const accent = type ? getItem(type).accent : '#ffffff';
      trail(this, pointer.worldX - vx * 0.6, pointer.worldY - lift, accent);
    }
  }

  /** Stereo place of a board position — left half sounds left, right sounds right. */
  private panOf(x: number): number {
    return panFor(x, this.scale.width);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.shadow?.destroy();

    const sprite = drag.sprite;
    const box = cellBox(this.layout, drag.from);
    sprite.setDepth(11);
    sprite.setAngle(0);
    this.tweens.killTweensOf(sprite);
    this.tweens.add({ targets: sprite, scale: (box.size * 1.02) / sprite.width, duration: 130, ease: 'Cubic.easeOut' });

    if (!drag.active) {
      this.select(drag.from);
      this.restoreIdlePulse(drag.uid, sprite);
      return;
    }

    const target = cellIndexAt(this.layout, pointer.worldX, pointer.worldY, this.layout.cellSize * 0.1);
    if (target !== null && target !== drag.from && this.tryMove(drag.from, target)) return;

    // invalid drop — snap back
    this.moveTweens.get(drag.uid)?.stop();
    const tween = this.tweens.add({
      targets: sprite,
      x: box.cx,
      y: box.cy,
      duration: 180,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.moveTweens.delete(drag.uid);
        landing(this, sprite, box.size);
      },
    });
    this.moveTweens.set(drag.uid, tween);

    if (target !== drag.from) {
      audio.invalid();
      if (target !== null) this.shakeCell(target);
    }
    this.restoreIdlePulse(drag.uid, sprite);
  }

  /** Brings the breathing back to a special product that is still on the board. */
  private restoreIdlePulse(uid: Uid, sprite: Phaser.GameObjects.Image): void {
    if (!sprite.active || this.items.get(uid) !== sprite) return;
    if (!sprite.texture.key.endsWith('-golden') && !sprite.texture.key.endsWith('-bomb')) return;
    this.startIdlePulse(uid, sprite);
  }

  private tryMove(from: number, to: number): boolean {
    const ok = useGameStore.getState().requestMove(from, to);
    if (ok) {
      audio.drop();
      this.clearSelection();
    } else {
      audio.invalid();
      this.shakeCell(to);
    }
    return ok;
  }

  /** Explains the ice, but not more than once every few seconds. */
  private renderIceHint(): void {
    if (this.time.now < this.frozenHintAt) return;
    this.frozenHintAt = this.time.now + 6000;
    useGameStore.getState().showToast('Товар заморожен: собери тройку прямо на полке', 'info');
  }

  private select(index: number): void {
    this.selection = this.selection === index ? null : index;
    if (this.selection !== null) audio.tap();
  }

  private clearSelection(): void {
    this.selection = null;
  }

  // --------------------------------------------------------------------- loop

  override update(time: number): void {
    this.pulse = time * 0.004;
    const state = useGameStore.getState();

    if (this.streak > 0 && time > this.streakTimer) this.streak = 0;

    const runtime = state.runtime;
    if (!runtime) {
      if (this.items.size > 0) {
        for (const sprite of this.items.values()) sprite.destroy();
        this.items.clear();
        this.idleTweens.clear();
        this.moveTweens.clear();
        this.renderedBoard = null;
        this.decor.clear();
        this.uiLayer.clear();
      }
      return;
    }

    const activeDecor = state.progress.activeDecor;
    if (activeDecor !== this.decorId && this.renderedBoard) {
      this.decorId = activeDecor;
      this.drawDecor(this.renderedBoard);
    }

    const board = runtime.board;
    const shapeChanged =
      !this.renderedBoard || this.renderedBoard.rows !== board.rows || this.renderedBoard.cols !== board.cols;

    if (shapeChanged) {
      this.rebuild(board);
    } else if (board !== this.renderedBoard) {
      this.syncBoard(board, true);
    }

    const lastBooster = state.lastBooster;
    if (lastBooster && lastBooster !== this.processedBooster) {
      this.processedBooster = lastBooster;
      this.playBooster(lastBooster.id, lastBooster.index);
    }

    const lastMove = state.lastMove;
    if (lastMove && lastMove !== this.processedMove) {
      this.processedMove = lastMove;
      if (lastMove.blast) this.playBlast(lastMove.blast);
      if (lastMove.combo >= COMBO_START) this.playCombo(lastMove.combo, lastMove.comboCoins, lastMove.to);
    }

    if (state.hint !== this.renderedHint) {
      this.renderedHint = state.hint;
      if (state.hint) audio.hint();
    }

    if (this.selection !== this.renderedSelection) {
      this.renderedSelection = this.selection;
    }

    this.drawOverlays(this.renderedHint);

    if (state.phase !== this.renderedPhase) {
      this.onPhaseChange(this.renderedPhase, state.phase);
      this.renderedPhase = state.phase;
    }
  }

  private onPhaseChange(previous: Phase, next: Phase): void {
    if (next === 'won' && previous !== 'won') {
      if (!this.celebrationDone) {
        this.celebrationDone = true;
        const colors = ITEM_IDS.slice(0, 8).map((id) => getItem(id).accent);
        confetti(this, this.scale.width, this.scale.height, colors);
        rain(this, this.scale.width, this.scale.height, colors);
        flash(this);
        audio.win();
        if (motionScale() >= 1) this.cameras.main.zoomTo(1.03, 400, 'Sine.easeOut', true);
      }
    } else if (next === 'lost' && previous !== 'lost') {
      audio.lose();
      if (motionScale() >= 1) this.cameras.main.shake(320, 0.006);
    } else if (next === 'playing' && (previous === 'menu' || previous === 'won' || previous === 'lost')) {
      this.celebrationDone = false;
      this.cameras.main.zoomTo(1, 1);
      this.layout = this.buildLayout(this.layout.rows, this.layout.cols);
    }
  }
}
