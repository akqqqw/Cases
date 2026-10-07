import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createGame } from '../game/createGame';
import { GameScene } from '../game/GameScene';

export interface GameCanvasProps {
  /** The scene is paused while the player is in the menu. */
  active: boolean;
}

/** Host element for the Phaser canvas. Created once, paused when not playing. */
export function GameCanvas({ active }: GameCanvasProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const game = createGame(host);
    gameRef.current = game;

    return () => {
      gameRef.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    let cancelled = false;
    const apply = (): void => {
      if (cancelled) return;
      const scene = game.scene.getScene(GameScene.KEY);
      if (!scene) return;
      const running = game.scene.isActive(GameScene.KEY);

      if (active && !running) {
        game.scene.resume(GameScene.KEY);
        game.scale.refresh();
      } else if (!active && running) {
        game.scene.pause(GameScene.KEY);
      }
    };

    if (game.isBooted) apply();
    else game.events.once('ready', apply);

    return () => {
      cancelled = true;
      game.events.off('ready', apply);
    };
  }, [active]);

  return <div className="game-canvas" ref={hostRef} aria-hidden={!active} />;
}
