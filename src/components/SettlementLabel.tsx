import { CheckCircle2, Clock, Ban, Radio, XCircle } from 'lucide-react';
import type { SettlementStatus } from '../types/fixtures.ts';
import { SETTLEMENT_LABEL_TONE } from '../utils/uiTone.ts';

interface SettlementLabelProps {
  status: SettlementStatus;
  prefix?: string;
  inverted?: boolean;
}

const SETTLEMENT_ICON = {
  Win: CheckCircle2,
  Lost: XCircle,
  Void: Ban,
  Live: Radio,
  Pending: Clock,
} as const;

const SETTLEMENT_TEXT: Record<SettlementStatus, string> = {
  Win: 'Win',
  Lost: 'Lost',
  Void: 'Void',
  Live: 'Live',
  Pending: 'Pending',
};

/**
 * Compact, text-first settlement badge. Colour always accompanies the word;
 * Live and Pending deliberately use neutral/sky tones rather than win green.
 */
export function SettlementLabel({
  status,
  prefix,
  inverted = false,
}: SettlementLabelProps) {
  const Icon = SETTLEMENT_ICON[status];
  const tone = inverted
    ? SETTLEMENT_LABEL_TONE[status].inverted
    : SETTLEMENT_LABEL_TONE[status].normal;

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${
        status === 'Pending' ? 'font-medium' : 'font-semibold'
      } ${tone}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{prefix ? `${prefix}: ` : ''}{SETTLEMENT_TEXT[status]}</span>
    </span>
  );
}
