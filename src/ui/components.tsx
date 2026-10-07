import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ItemIcon } from './ItemIcon';
import { getItem } from '../data/items';
import { getLang, t } from '../platform/i18n';

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  size?: 'md' | 'lg' | 'sm';
  title?: string;
  badge?: ReactNode;
  className?: string;
}

export function Button({
  children,
  onClick,
  tone = 'primary',
  disabled = false,
  size = 'md',
  title,
  badge,
  className,
}: ButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={`btn btn-${tone} btn-${size}${className ? ` ${className}` : ''}`}
      data-btn={className ?? undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <span className="btn-content">{children}</span>
      {badge !== undefined ? <span className="btn-badge">{badge}</span> : null}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`icon-btn${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Star({ filled, index }: { filled: boolean; index: number }): React.ReactElement {
  // Every star owns its gradient: a shared `id` would be invalid HTML and the
  // first definition in the document would win for all three.
  const gradientId = `starFill-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <svg
      className={`star${filled ? ' star-filled' : ''}${filled && index === 2 ? ' star-best' : ''}`}
      style={{ animationDelay: `${index * 180}ms` }}
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      <path
        d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"
        fill={filled ? `url(#${gradientId})` : 'rgba(74,44,20,0.16)'}
        stroke={filled ? '#e08a1e' : 'rgba(74,44,20,0.25)'}
        strokeWidth="1.2"
      />
      {filled ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffd76a" />
            <stop offset="100%" stopColor="#ffab2e" />
          </linearGradient>
        </defs>
      ) : null}
    </svg>
  );
}

export function StarRow({ stars, total = 3, size = 46 }: { stars: number; total?: number; size?: number }): React.ReactElement {
  return (
    <div className="star-row" style={{ height: size }}>
      {Array.from({ length: total }, (_, index) => (
        <div className="star-slot" key={index} style={{ width: size, height: size }}>
          <Star filled={index < stars} index={index} />
        </div>
      ))}
    </div>
  );
}

export function CoinPill({ coins, compact = false }: { coins: number; compact?: boolean }): React.ReactElement {
  // Coins are the main reward loop, so the pill reacts to every change: it
  // bounces up for a gain and settles for a loss. Purely visual — the number
  // itself is never animated.
  const [bump, setBump] = useState<'' | 'coin-pill-up' | 'coin-pill-down'>('');
  const previous = useRef(coins);

  useEffect(() => {
    if (coins === previous.current) {
      // A screen may remount the pill with the same value: keep it still.
      previous.current = coins;
      return;
    }
    const direction = coins > previous.current ? 'coin-pill-up' : 'coin-pill-down';
    const delta = Math.abs(coins - previous.current);
    previous.current = coins;
    setBump(delta > 0 ? direction : '');
    const timer = setTimeout(() => setBump(''), 420);
    return () => clearTimeout(timer);
  }, [coins]);

  return (
    <div className={`coin-pill${compact ? ' coin-pill-compact' : ''}${bump ? ` ${bump}` : ''}`} title={t('common.coins')}>
      <span className="coin-icon" aria-hidden="true" />
      <span className="coin-value">{coins.toLocaleString(getLang() === 'en' ? 'en-US' : 'ru-RU')}</span>
    </div>
  );
}

export function GoalChip({
  type,
  left,
  total,
  size = 46,
}: {
  type: string;
  left: number;
  total: number;
  size?: number;
}): React.ReactElement {
  const done = left <= 0;
  return (
    <div className={`goal-chip${done ? ' goal-chip-done' : ''}`} title={`${getItem(type).name}: осталось ${left} из ${total}`}>
      <ItemIcon id={type} size={size} tile />
      <span className="goal-chip-count">
        {done ? '✓' : `${left}`}
        <span className="goal-chip-total">/{total}</span>
      </span>
    </div>
  );
}

export function SoundIcon({ on }: { on: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M4 9.5h3l4.2-3.4v11.8L7 14.5H4z"
        fill="currentColor"
      />
      {on ? (
        <>
          <path d="M15.4 8.4a5 5 0 010 7.2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d="M18 6a8.4 8.4 0 010 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <path d="M15.5 9l5 6m0-6l-5 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function PauseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor" />
      <rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor" />
    </svg>
  );
}

export function HintIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 3a6 6 0 00-3.5 10.9c.6.4.9 1 .9 1.6V17h5.2v-1.5c0-.6.3-1.2.9-1.6A6 6 0 0012 3z"
        fill="currentColor"
      />
      <rect x="9.4" y="18.4" width="5.2" height="2.4" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function UndoIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M9 7H5.5V3.5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.8 7.4A7.4 7.4 0 1112 19.4"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
