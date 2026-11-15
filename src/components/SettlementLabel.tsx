import { CheckCircle2, Clock, Ban, Radio, XCircle } from 'lucide-react';
import type { SettlementStatus } from '../types/fixtures.ts';

interface SettlementLabelProps {
  status: SettlementStatus;
  prefix?: string;
  inverted?: boolean;
}

export function SettlementLabel({
  status,
  prefix,
  inverted = false,
}: SettlementLabelProps) {
  const textPrefix = prefix ? `${prefix}: ` : '';

  if (status === 'Win') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
          inverted ? 'text-emerald-100' : 'text-emerald-700'
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{textPrefix}Win</span>
      </span>
    );
  }

  if (status === 'Lost') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
          inverted ? 'text-red-200' : 'text-red-600'
        }`}
      >
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{textPrefix}Lost</span>
      </span>
    );
  }

  if (status === 'Void') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
          inverted ? 'text-amber-200' : 'text-amber-700'
        }`}
      >
        <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{textPrefix}Void</span>
      </span>
    );
  }

  if (status === 'Live') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
          inverted ? 'text-emerald-100' : 'text-emerald-700'
        }`}
      >
        <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{textPrefix}Live</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap ${
        inverted ? 'text-emerald-100' : 'text-slate-500'
      }`}
    >
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{textPrefix}Pending</span>
    </span>
  );
}
