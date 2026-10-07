import Phaser from 'phaser';
import { GameScene } from './GameScene';

/** Boots Phaser inside a plain DOM container that fills the viewport. */
export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#f2dcbb',
    banner: false,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
    },
    render: {
      antialias: true,
      powerPreference: 'high-performance',
    },
    // The game synthesises its own sounds with WebAudio (see `audio.ts`).
    audio: { noAudio: true },
    scene: [GameScene],
  });
}
