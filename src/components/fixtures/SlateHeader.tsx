import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DataStatus } from '../ui/DataStatus.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { fmtCount } from '../../utils/format.ts';

interface SlateHeaderProps {
  selectedDate: string;
  todayDate: string;
  displayDate: string;
  timezoneLabel: string;
  dataProvider: string;
  slateSource?: 'live' | 'archive';
  capturedAt?: string;
  isFetchingDate: boolean;
  isRecapturing: boolean;
  onRecapturePrices?: () => void;
  showRecapture: boolean;
  resultCount: number;
  totalCount: number;
}

/** Page title, provenance strip and the explicit fresh-odds action. */
export function SlateHeader({
  selectedDate,
  todayDate,
  displayDate,
  timezoneLabel,
  dataProvider,
  slateSource,
  capturedAt,
  isFetchingDate,
  isRecapturing,
  onRecapturePrices,
  showRecapture,
  resultCount,
  totalCount,
}: SlateHeaderProps) {
  const [confirmRecapture, setConfirmRecapture] = useState(false);

  useEffect(() => setConfirmRecapture(false), [selectedDate]);

  const recaptureAction =
    showRecapture && onRecapturePrices ? (
      confirmRecapture ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-slate-700">
            Replace the frozen prices for {selectedDate}?
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirmRecapture(false);
              onRecapturePrices();
            }}
            disabled={isRecapturing}
            className="rounded-md bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirmRecapture(false)}
            disabled={isRecapturing}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-white disabled:opacity-60 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmRecapture(true)}
          disabled={isRecapturing || isFetchingDate}
          title="Fetch fresh odds for this date and replace the frozen prices. The board and its pick will be rebuilt from the new prices."
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRecapturing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {isRecapturing ? 'Recapturing…' : 'Recapture Prices'}
        </button>
      )
    ) : null;

  return (
    <div className="space-y-3">
      <PageHeader
        scope="global"
        eyebrow="Matchday workbench"
        title={
          selectedDate === todayDate
            ? "Today's Football Fixture Board"
            : 'Football Fixture Board'
        }
        meta={
          <span className="font-mono tabular-nums">
            Showing {fmtCount(resultCount)} of {fmtCount(totalCount)} matches
          </span>
        }
        actions={recaptureAction}
      />
      <DataStatus
        source={dataProvider}
        mode={slateSource === 'archive' ? 'Archived slate' : 'Live slate'}
        capturedAt={capturedAt}
        note={
          <span>
            {displayDate} · {timezoneLabel}
          </span>
        }
      />
    </div>
  );
}
