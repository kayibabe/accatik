import type { MarketType } from '../../types/fixtures.ts';
import {
  marketChipTone,
  marketTextTone,
  marketTypeFromLabel,
} from '../../utils/marketLabelTone.ts';

interface MarketLabelProps {
  label: string;
  marketType?: MarketType | null;
  className?: string;
  title?: string;
}

/** Pill used on insight cards: the printed name stays the primary signal. */
export function MarketLabelChip({
  label,
  marketType,
  className = '',
  title,
}: MarketLabelProps) {
  const type = marketType ?? marketTypeFromLabel(label);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-xs font-semibold leading-snug ${marketChipTone(
        type
      )} ${className}`}
      title={title}
    >
      {label}
    </span>
  );
}

/** Compact text accent for analytics rows where a pill would crowd the cell. */
export function MarketLabelText({
  label,
  marketType,
  className = '',
  title,
}: MarketLabelProps) {
  const type = marketType ?? marketTypeFromLabel(label);
  return (
    <span className={`font-semibold ${marketTextTone(type)} ${className}`} title={title}>
      {label}
    </span>
  );
}
