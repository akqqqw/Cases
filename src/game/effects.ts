import Phaser from 'phaser';
import { hexToInt } from '../data/colors';
import { motionScale, particleCount } from './juice';

const SPARK_KEY = 'fx-spark';
const GLOW_KEY = 'fx-glow';
const STAR_KEY = 'fx-star';
const RIBBON_KEY = 'fx-ribbon';
const SMOKE_KEY = 'fx-smoke';
const ICE_KEY = 'fx-ice';
const PRAISE = ['Отлично!', 'Есть!', 'Класс!', 'Чисто!', 'Супер!', 'Вот так!'];

/**
 * The soft round spark: a wide halo, a bright core and a tiny highlight, so a
 * single texture reads as a glowing particle at any scale.
 */
function sparkTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SPARK_KEY)) return;
  const size = 48;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.16);
  g.fillCircle(size / 2, size / 2, size / 2);
  g.fillStyle(0xffffff, 0.4);
  g.fillCircle(size / 2, size / 2, size / 2.9);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(size / 2, size / 2, size / 5.5);
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(size / 2 - size * 0.06, size / 2 - size * 0.07, size / 12);
  g.generateTexture(SPARK_KEY, size, size);
  g.destroy();
}

/** Large almost transparent puff: turns a burst into a soft explosion of light. */
function glowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_KEY)) return;
  const size = 160;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (const [radius, alpha] of [
    [size * 0.5, 0.1],
    [size * 0.36, 0.16],
    [size * 0.22, 0.24],
  ] as Array<[number, number]>) {
    g.fillStyle(0xffffff, alpha);
    g.fillCircle(size / 2, size / 2, radius);
  }
  g.generateTexture(GLOW_KEY, size, size);
  g.destroy();
}

/** Four-point sparkle — the shape the eye reads as "shine", not as "dust". */
function starTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(STAR_KEY)) return;
  const size = 64;
  const c = size / 2;
  const long = size * 0.48;
  const short = size * 0.1;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.85);
  // two crossed diamonds make a clean four-point glitter
  g.fillPoints(
    [
      new Phaser.Geom.Point(c, c - long),
      new Phaser.Geom.Point(c + short, c),
      new Phaser.Geom.Point(c, c + long),
      new Phaser.Geom.Point(c - short, c),
    ],
    true,
  );
  g.fillPoints(
    [
      new Phaser.Geom.Point(c - long, c),
      new Phaser.Geom.Point(c, c + short),
      new Phaser.Geom.Point(c + long, c),
      new Phaser.Geom.Point(c - short, c - short),
    ],
    true,
  );
  g.fillStyle(0xffffff, 1);
  g.fillCircle(c, c, short * 0.9);
  g.generateTexture(STAR_KEY, size, size);
  g.destroy();
}

/** Little paper ribbon for the confetti: it tumbles instead of falling straight. */
function ribbonTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RIBBON_KEY)) return;
  const w = 26;
  const h = 40;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.35);
  g.fillRoundedRect(1, 1, w - 2, h - 2, 6);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(4, 4, w - 8, h - 12, 5);
  g.generateTexture(RIBBON_KEY, w, h);
  g.destroy();
}

/** Soft grey puff for smoke and dust. */
function smokeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SMOKE_KEY)) return;
  const size = 96;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.14);
  g.fillCircle(size * 0.42, size * 0.5, size * 0.4);
  g.fillStyle(0xffffff, 0.12);
  g.fillCircle(size * 0.62, size * 0.42, size * 0.32);
  g.fillStyle(0xffffff, 0.16);
  g.fillCircle(size * 0.52, size * 0.62, size * 0.28);
  g.generateTexture(SMOKE_KEY, size, size);
  g.destroy();
}

/** Soft round particle used by every burst (plus its glow / star / smoke mates). */
export function ensureFxTextures(scene: Phaser.Scene): void {
  sparkTexture(scene);
  glowTexture(scene);
  starTexture(scene);
  ribbonTexture(scene);
  smokeTexture(scene);
}

export function sparkTextureKey(): string {
  return SPARK_KEY;
}

export function starTextureKey(): string {
  return STAR_KEY;
}

export function glowTextureKey(): string {
  return GLOW_KEY;
}

/** Icy overlay drawn on top of products that are pinned to their cell. */
export function ensureIceTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(ICE_KEY)) return;

  const size = 192;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xdff2ff, 0.55);
  g.fillRoundedRect(6, 6, size - 12, size - 12, size * 0.24);
  g.fillStyle(0xffffff, 0.45);
  g.fillRoundedRect(16, 14, size - 32, size * 0.24, size * 0.14);
  g.lineStyle(6, 0xffffff, 0.85);
  g.strokeRoundedRect(6, 6, size - 12, size - 12, size * 0.24);

  // snowflake: six spokes with little branches
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.3;
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i;
    const ex = cx + Math.cos(angle) * radius;
    const ey = cy + Math.sin(angle) * radius;
    g.lineStyle(5, 0xffffff, 0.95);
    g.lineBetween(cx, cy, ex, ey);
    const bx = cx + Math.cos(angle) * radius * 0.6;
    const by = cy + Math.sin(angle) * radius * 0.6;
    for (const side of [-0.6, 0.6]) {
      g.lineBetween(bx, by, bx + Math.cos(angle + side) * radius * 0.28, by + Math.sin(angle + side) * radius * 0.28);
    }
  }

  g.generateTexture(ICE_KEY, size, size);
  g.destroy();
}

export function iceTextureKey(): string {
  return ICE_KEY;
}

/**
 * Explosion of a bomb: a shock ring, a hot core, flying debris and dust.
 * Screen shake lives next to it (`shake()` is skipped when the player asked for
 * less motion), so the blast is still readable without the camera jumping.
 */
export function explosion(scene: Phaser.Scene, x: number, y: number, radius: number): void {
  ensureFxTextures(scene);
  const scale = motionScale();

  const ring = scene.add.circle(x, y, radius * 0.35);
  ring.setStrokeStyle(10, 0xffa53d, 0.95);
  ring.setDepth(45);
  scene.tweens.add({
    targets: ring,
    scale: 2.6,
    alpha: 0,
    duration: 480,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });

  const core = scene.add.circle(x, y, radius * 0.32, 0xffd76a, 0.85);
  core.setDepth(44);
  scene.tweens.add({
    targets: core,
    scale: 1.6,
    alpha: 0,
    duration: 320,
    ease: 'Sine.easeOut',
    onComplete: () => core.destroy(),
  });

  // A short-lived bright flash sells the "boom" more than the ring does.
  const flare = scene.add.image(x, y, GLOW_KEY);
  flare.setTint(0xffd76a);
  flare.setDepth(43);
  flare.setScale((radius / 160) * 1.6);
  flare.setAlpha(0.85 * scale);
  scene.tweens.add({
    targets: flare,
    scale: flare.scale * 2.2,
    alpha: 0,
    duration: 280,
    ease: 'Cubic.easeOut',
    onComplete: () => flare.destroy(),
  });

  for (const colour of ['#ff8a3d', '#ffd76a', '#ff5f4d']) {
    burst(scene, x, y, colour, 10);
  }
  debris(scene, x, y, radius, ['#7a4a24', '#a8703a', '#5d3a1c']);
  smoke(scene, x, y, radius);
}

/** Heavy chunks thrown out of a blast: they tumble and fall with gravity. */
export function debris(scene: Phaser.Scene, x: number, y: number, radius: number, colors: string[]): void {
  ensureFxTextures(scene);
  const count = particleCount(12);
  for (let i = 0; i < count; i += 1) {
    const colour = colors[i % colors.length] as string;
    const piece = scene.add.image(x, y, RIBBON_KEY);
    piece.setTint(hexToInt(colour));
    piece.setDepth(46);
    piece.setScale(0.16 + Math.random() * 0.16, 0.12 + Math.random() * 0.14);
    piece.setAngle(Math.random() * 360);

    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const power = radius * (0.5 + Math.random() * 0.6);
    scene.tweens.add({
      targets: piece,
      x: x + Math.cos(angle) * power,
      // gravity: the piece flies out, then drops below the shelf line
      y: y + Math.sin(angle) * power * 0.5 + radius * (0.5 + Math.random() * 0.6),
      angle: piece.angle + Phaser.Math.Between(-240, 240),
      alpha: 0,
      duration: 520 + Math.random() * 260,
      ease: 'Quad.easeIn',
      onComplete: () => piece.destroy(),
    });
  }
}

/** Slow rising dust puffs — the "after" of a blast. */
export function smoke(scene: Phaser.Scene, x: number, y: number, radius: number): void {
  ensureFxTextures(scene);
  const count = particleCount(5);
  for (let i = 0; i < count; i += 1) {
    const puff = scene.add.image(x + (Math.random() - 0.5) * radius * 0.5, y, SMOKE_KEY);
    puff.setTint(0x8d7a6a);
    puff.setDepth(47);
    puff.setScale((radius / 96) * (0.5 + Math.random() * 0.4));
    puff.setAlpha(0.55);
    scene.tweens.add({
      targets: puff,
      y: y - radius * (0.5 + Math.random() * 0.5),
      x: puff.x + (Math.random() - 0.5) * radius,
      scale: puff.scale * 1.7,
      alpha: 0,
      duration: 700 + Math.random() * 400,
      delay: 60 + Math.random() * 140,
      ease: 'Sine.easeOut',
      onComplete: () => puff.destroy(),
    });
  }
}

/**
 * Match effect: sparks flying outwards, a few four-point sparkles and a soft
 * glow, plus an expanding ring. Sparks are slightly uneven in size and speed,
 * which is what makes the burst feel organic instead of mechanical.
 */
export function burst(scene: Phaser.Scene, x: number, y: number, color: string, count = 16): void {
  ensureFxTextures(scene);
  const tint = hexToInt(color);
  const total = particleCount(count);
  const scale = motionScale();

  const glow = scene.add.image(x, y, GLOW_KEY);
  glow.setTint(tint);
  glow.setDepth(38);
  glow.setScale(0.22);
  glow.setAlpha(0.7 * scale);
  scene.tweens.add({
    targets: glow,
    scale: 0.62,
    alpha: 0,
    duration: 420,
    ease: 'Sine.easeOut',
    onComplete: () => glow.destroy(),
  });

  for (let i = 0; i < total; i += 1) {
    const angle = (Math.PI * 2 * i) / total + Math.random() * 0.5;
    const distance = 24 + Math.random() * 52;
    // every third particle is a sparkle: a burst of only round dots reads flat
    const glitter = i % 3 === 0;
    const spark = scene.add.image(x, y, glitter ? STAR_KEY : SPARK_KEY);
    spark.setTint(tint);
    spark.setDepth(40);
    spark.setScale(glitter ? 0.18 + Math.random() * 0.2 : 0.16 + Math.random() * 0.22);
    if (glitter) spark.setAngle(Math.random() * 90);

    scene.tweens.add({
      targets: spark,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      scale: 0,
      alpha: 0,
      angle: glitter ? spark.angle + Phaser.Math.Between(-90, 90) : 0,
      duration: 380 + Math.random() * 260,
      ease: 'Cubic.easeOut',
      onComplete: () => spark.destroy(),
    });
  }

  const ring = scene.add.circle(x, y, 14);
  ring.setStrokeStyle(5, tint, 0.9);
  ring.setDepth(39);
  scene.tweens.add({
    targets: ring,
    scale: 3.4,
    alpha: 0,
    duration: 420,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
}

/**
 * A single soft spark dropped behind a product that is being dragged — the
 * light trail that tells the eye where the product came from. Cheap on
 * purpose: one image per call, no tweens, removed by the scene.
 */
export function trail(scene: Phaser.Scene, x: number, y: number, color: string): void {
  const spark = scene.add.image(x, y, SPARK_KEY);
  spark.setTint(hexToInt(color));
  spark.setDepth(53);
  spark.setScale(0.22);
  spark.setAlpha(0.5);
  scene.tweens.add({
    targets: spark,
    scale: 0.02,
    alpha: 0,
    duration: 300,
    ease: 'Sine.easeOut',
    onComplete: () => spark.destroy(),
  });
}

/**
 * Squash and stretch for a product that lands in a cell: the sprite dips along
 * Y and springs back. Small, but this is the difference between "a picture
 * moved" and "an object was put down".
 */
export function landing(scene: Phaser.Scene, target: Phaser.GameObjects.Image, size: number): void {
  if (motionScale() < 1) return;
  const base = size / target.width;
  const baseY = size / target.height;
  scene.tweens.killTweensOf(target);
  target.setScale(base * 1.12, baseY * 0.86);
  scene.tweens.add({
    targets: target,
    scaleX: base,
    scaleY: baseY,
    duration: 240,
    ease: 'Back.easeOut',
  });
}

/** Golden shine: a bright band sweeping across the tile. */
export function shine(scene: Phaser.Scene, x: number, y: number, size: number): void {
  const band = scene.add.rectangle(x, y, size * 0.22, size * 1.5, 0xfff6d0, 0.8);
  band.setDepth(55);
  band.setAngle(24);
  band.setScale(0.4, 0.9);
  const from = y - size * 0.75;
  band.setY(from);
  scene.tweens.add({
    targets: band,
    y: y + size * 0.75,
    alpha: { from: 0.9, to: 0 },
    scaleX: 1.1,
    duration: 420,
    ease: 'Sine.easeIn',
    onComplete: () => band.destroy(),
  });
}

/** Edge glow that grows with the combo — the screen itself reacts to the streak. */
export function vignette(scene: Phaser.Scene, color: string, strength: number): void {
  const scale = motionScale();
  const alpha = Math.min(0.4, 0.12 + strength * 0.03) * scale;
  const { width, height } = scene.scale;
  const band = 26;
  const tint = hexToInt(color);
  const frames: Phaser.GameObjects.Rectangle[] = [
    scene.add.rectangle(0, 0, width, band, tint, alpha).setOrigin(0, 0),
    scene.add.rectangle(0, height - band, width, band, tint, alpha).setOrigin(0, 0),
    scene.add.rectangle(0, 0, band, height, tint, alpha).setOrigin(0, 0),
    scene.add.rectangle(width - band, 0, band, height, tint, alpha).setOrigin(0, 0),
  ];
  for (const frame of frames) {
    frame.setDepth(78);
    frame.setScrollFactor(0);
    scene.tweens.add({
      targets: frame,
      alpha: 0,
      duration: 620,
      ease: 'Sine.easeOut',
      onComplete: () => frame.destroy(),
    });
  }
}

/** Sparkle rain for a finished level: light falling from above, no rules broken. */
export function rain(scene: Phaser.Scene, width: number, height: number, colors: string[]): void {
  ensureFxTextures(scene);
  const total = particleCount(30);
  for (let i = 0; i < total; i += 1) {
    const colour = colors[i % colors.length] as string;
    const sparkle = scene.add.image(Math.random() * width, -20 - Math.random() * height * 0.5, STAR_KEY);
    sparkle.setTint(hexToInt(colour));
    sparkle.setDepth(69);
    sparkle.setScale(0.12 + Math.random() * 0.2);
    sparkle.setAngle(Math.random() * 90);
    scene.tweens.add({
      targets: sparkle,
      y: height + 30,
      x: sparkle.x + (Math.random() - 0.5) * 90,
      angle: sparkle.angle + Phaser.Math.Between(-180, 180),
      alpha: { from: 0.95, to: 0.15 },
      duration: 1600 + Math.random() * 1400,
      delay: Math.random() * 900,
      ease: 'Sine.easeIn',
      onComplete: () => sparkle.destroy(),
    });
  }
}

/** Small pop shown when an item lands in its new cell. */
export function pop(scene: Phaser.Scene, target: Phaser.GameObjects.Image, color: string): void {
  const glow = scene.add.circle(target.x, target.y, target.displayWidth * 0.55);
  glow.setStrokeStyle(4, hexToInt(color), 0.7);
  glow.setDepth(target.depth - 1);
  scene.tweens.add({
    targets: glow,
    scale: 1.5,
    alpha: 0,
    duration: 320,
    ease: 'Sine.easeOut',
    onComplete: () => glow.destroy(),
  });
}

/**
 * Floating praise text after a successful match. It pops in from 60 % and drifts
 * up with a soft drop shadow, so it stays readable over both a light shelf and
 * a dark background.
 */
export function floatText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#fff8e7'): void {
  const size = Math.round(scene.scale.width * 0.034);
  const label = scene.add.text(x, y, text, {
    fontFamily: 'Nunito, "Segoe UI", system-ui, sans-serif',
    fontSize: `${size}px`,
    fontStyle: '900',
    color,
  });
  label.setOrigin(0.5);
  label.setDepth(60);
  label.setStroke('#5b3a1e', Math.max(5, Math.round(size * 0.16)));
  label.setShadow(0, size * 0.14, 'rgba(40, 20, 8, 0.45)', Math.round(size * 0.2), false, true);
  label.setScale(0.6);

  scene.tweens.add({
    targets: label,
    scale: 1,
    duration: 190,
    ease: 'Back.easeOut',
  });
  scene.tweens.add({
    targets: label,
    y: y - 58,
    alpha: 0,
    scale: 1.14,
    delay: 170,
    duration: 720,
    ease: 'Cubic.easeOut',
    onComplete: () => label.destroy(),
  });
}

export function praiseText(index = 0): string {
  return PRAISE[index % PRAISE.length] as string;
}

/**
 * Celebration confetti for a finished level: tumbling paper ribbons mixed with
 * round sparks. The motion budget cuts the amount down, never to zero — the
 * win must stay a win.
 */
export function confetti(scene: Phaser.Scene, width: number, height: number, colors: string[]): void {
  ensureFxTextures(scene);
  const total = particleCount(46);

  for (let i = 0; i < total; i += 1) {
    const color = colors[i % colors.length] as string;
    const ribbon = i % 2 === 0;
    const piece = scene.add.image(
      Math.random() * width,
      -30 - Math.random() * height * 0.4,
      ribbon ? RIBBON_KEY : SPARK_KEY,
    );
    piece.setTint(hexToInt(color));
    piece.setScale(ribbon ? 0.5 + Math.random() * 0.35 : 0.2 + Math.random() * 0.3);
    piece.setAngle(Math.random() * 360);
    piece.setDepth(70);

    scene.tweens.add({
      targets: piece,
      y: height + 40,
      x: piece.x + (Math.random() - 0.5) * 160,
      angle: piece.angle + 360 * (Math.random() > 0.5 ? 1 : -1),
      duration: 2200 + Math.random() * 1600,
      delay: Math.random() * 700,
      ease: 'Sine.easeIn',
      onComplete: () => piece.destroy(),
    });
  }
}

/** Soft full-screen flash, used on level completion. */
export function flash(scene: Phaser.Scene, color = 0xfff2c8, alpha = 0.35): void {
  const overlay = scene.add.rectangle(
    0,
    0,
    scene.scale.width,
    scene.scale.height,
    color,
    alpha * motionScale(),
  );
  overlay.setOrigin(0);
  overlay.setDepth(80);
  scene.tweens.add({
    targets: overlay,
    alpha: 0,
    duration: 420,
    ease: 'Sine.easeOut',
    onComplete: () => overlay.destroy(),
  });
}

/** Shake used when the player cannot drop an item there. */
export function shake(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject & { x: number }, amount = 8): void {
  // Shaking is the first thing to go when the player asked for less motion.
  if (motionScale() < 1) return;
  const originX = target.x;
  scene.tweens.add({
    targets: target,
    x: originX + amount,
    duration: 60,
    yoyo: true,
    repeat: 2,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      target.x = originX;
    },
  });
}
