import type { ReactElement } from 'react';
import { ICON_VIEWBOX, ICONS, type IconShape } from '../data/iconShapes';
import { getItem } from '../data/items';

function polar(x: number, y: number, r: number, degrees: number): [number, number] {
  const rad = (degrees * Math.PI) / 180;
  return [x + r * Math.cos(rad), y + r * Math.sin(rad)];
}

/** Converts one icon shape into an SVG element. */
export function shapeToSvg(shape: IconShape, key: number): ReactElement {
  const fill = shape.fill;
  const alpha = shape.alpha ?? 1;
  const stroke = shape.stroke;

  switch (shape.k) {
    case 'circle':
      return <circle key={key} cx={shape.x} cy={shape.y} r={shape.r} fill={fill} fillOpacity={alpha} />;
    case 'ring':
      return (
        <circle
          key={key}
          cx={shape.x}
          cy={shape.y}
          r={shape.r}
          fill="none"
          stroke={fill}
          strokeOpacity={alpha}
          strokeWidth={shape.sw}
        />
      );
    case 'rect': {
      const rotate = shape.rot ? `rotate(${shape.rot} ${shape.x + shape.w / 2} ${shape.y + shape.h / 2})` : undefined;
      return (
        <rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.r ?? 0}
          fill={fill}
          fillOpacity={alpha}
          stroke={stroke}
          strokeWidth={shape.sw}
          transform={rotate}
        />
      );
    }
    case 'poly':
      return (
        <polygon
          key={key}
          points={shape.points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill={fill}
          fillOpacity={alpha}
          stroke={stroke}
          strokeWidth={shape.sw}
        />
      );
    case 'line':
      return (
        <line
          key={key}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={stroke ?? fill}
          strokeOpacity={alpha}
          strokeWidth={shape.sw}
          strokeLinecap="round"
        />
      );
    case 'arc': {
      const color = shape.stroke ?? fill;
      if (Math.abs(shape.to - shape.from) >= 359.9) {
        return (
          <circle
            key={key}
            cx={shape.x}
            cy={shape.y}
            r={shape.r}
            fill="none"
            stroke={color}
            strokeOpacity={alpha}
            strokeWidth={shape.sw}
          />
        );
      }
      const [sx, sy] = polar(shape.x, shape.y, shape.r, shape.from);
      const [ex, ey] = polar(shape.x, shape.y, shape.r, shape.to);
      const largeArc = Math.abs(shape.to - shape.from) > 180 ? 1 : 0;
      const sweep = shape.to > shape.from ? 1 : 0;
      return (
        <path
          key={key}
          d={`M ${sx} ${sy} A ${shape.r} ${shape.r} 0 ${largeArc} ${sweep} ${ex} ${ey}`}
          fill="none"
          stroke={color}
          strokeOpacity={alpha}
          strokeWidth={shape.sw}
          strokeLinecap="round"
        />
      );
    }
    default: {
      // Compile-time guard: a new shape kind must be rendered here too.
      const unhandled: never = shape;
      return <g key={key} data-unhandled={JSON.stringify(unhandled)} />;
    }
  }
}

export interface ItemIconProps {
  id: string;
  size?: number;
  /** Adds a soft tile behind the icon. */
  tile?: boolean;
  className?: string;
  title?: string;
}

/** Vector product icon — identical to what the game renders on the shelves. */
export function ItemIcon({ id, size = 44, tile = false, className, title }: ItemIconProps): ReactElement | null {
  const icon = ICONS[id];
  if (!icon) return null;

  const item = getItem(id);
  const background = tile ? item.tile : 'transparent';

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      role="img"
      aria-label={title ?? item.name}
    >
      {title ? <title>{title}</title> : null}
      {tile ? (
        <rect x="2" y="2" width="96" height="96" rx="24" fill={background} stroke="rgba(74,44,20,0.12)" strokeWidth="2" />
      ) : null}
      {icon.shapes.map(shapeToSvg)}
    </svg>
  );
}

export function ItemTile({ id, size = 48, className }: { id: string; size?: number; className?: string }): ReactElement | null {
  return <ItemIcon id={id} size={size} tile className={className} />;
}
