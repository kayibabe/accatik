import { AlertCircle, Sparkles } from 'lucide-react';
import type { MarketOption } from '../../types/fixtures.ts';
import type { SortState } from '../../utils/tableSort.ts';
import type { SortDirection } from '../../utils/tableSort.ts';
import { DataTable, type DataTableColumn } from '../ui/DataTable.tsx';
import { SortableTh } from '../SortableTh.tsx';
import { SettlementLabel } from '../SettlementLabel.tsx';
import { evaluateMarketSettlement } from '../../utils/accaMath.ts';
import { marketProbability } from '../../utils/probability.ts';
import { fmtOdds, fmtPercent } from '../../utils/format.ts';
import type { ModelComparisonRow } from './types.ts';
import {
  formatArchiveTime,
  modelComparisonRows,
  type FixtureCardModel,
} from './fixtureShared.ts';

interface BriefPanelProps {
  model: FixtureCardModel;
  marketSort: SortState;
  onMarketSort: (key: string, defaultDirection?: SortDirection) => void;
  onRequestDeepAnalysis: () => void;
}

/** Expanded tactical brief: sortable market ladder, model comparison and notes. */
export function BriefPanel({
  model,
  marketSort,
  onMarketSort,
  onRequestDeepAnalysis,
}: BriefPanelProps) {
  const { fixture, tableMarkets, deepAnalysis, isAnalyzing, analysisError } = model;
  const modelRows: ModelComparisonRow[] = modelComparisonRows(fixture);
  const showSettlement =
    fixture.status === 'Finished' || fixture.status === 'Void';

  const columns: ReadonlyArray<DataTableColumn<MarketOption>> = [
    {
      key: 'market',
      header: (
        <SortableTh
          bare
          label="Market"
          columnKey="market"
          sort={marketSort}
          onSort={onMarketSort}
        />
      ),
      cell: (market) => (
        <span className="font-medium text-slate-900">{market.label}</span>
      ),
      priority: 'primary',
    },
    {
      key: 'odds',
      header: (
        <SortableTh
          bare
          label="Odds"
          columnKey="odds"
          sort={marketSort}
          onSort={onMarketSort}
          defaultDirection="desc"
          align="right"
        />
      ),
      cell: (market) => fmtOdds(market.odds),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'fair',
      header: (
        <SortableTh
          bare
          label="Fair Prob"
          columnKey="fair"
          sort={marketSort}
          onSort={onMarketSort}
          defaultDirection="desc"
          align="right"
        />
      ),
      cell: (market) => (
        <span
          title={`Raw implied: ${fmtPercent(market.impliedProbability)}`}
        >
          {fmtPercent(marketProbability(market))}
        </span>
      ),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'book',
      header: (
        <SortableTh
          bare
          label="Book"
          columnKey="book"
          sort={marketSort}
          onSort={onMarketSort}
        />
      ),
      cell: (market) => market.bookmaker || '—',
      priority: 'secondary',
    },
    ...(showSettlement
      ? [
          {
            key: 'status',
            header: (
              <SortableTh
                bare
                label="Status"
                columnKey="status"
                sort={marketSort}
                onSort={onMarketSort}
              />
            ),
            cell: (market: MarketOption) => (
              <SettlementLabel
                status={evaluateMarketSettlement(fixture, market)}
              />
            ),
          },
        ]
      : []),
    {
      key: 'rationale',
      header: (
        <SortableTh
          bare
          label="Tactical Rationale"
          columnKey="rationale"
          sort={marketSort}
          onSort={onMarketSort}
        />
      ),
      cell: (market) => (
        <span className="text-slate-600">{market.rationale}</span>
      ),
      priority: 'tertiary',
    },
  ];

  return (
    <div
      id={`brief-${fixture.id}`}
      className="rounded-lg border border-emerald-200 bg-slate-50/70 px-3 py-3 space-y-3 sm:px-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Tactical brief
          </span>
          Market rationales &amp; fair probabilities
          <span className="ml-2 font-normal text-slate-500">
            click a column to sort
          </span>
        </h3>
        <button
          type="button"
          onClick={onRequestDeepAnalysis}
          disabled={isAnalyzing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {isAnalyzing
            ? 'Loading Team News & Full Brief…'
            : deepAnalysis
            ? 'Refresh Team News & Full Brief'
            : 'Load Team News & Full Brief'}
        </button>
      </div>

      {tableMarkets.length > 0 && (
        <DataTable
          columns={columns}
          rows={tableMarkets}
          rowKey={(market) => market.id}
          caption={`Market ladder for ${fixture.homeTeam} versus ${fixture.awayTeam}`}
          compact
          minWidth="min-w-[560px]"
          details={(market) => (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-slate-500">Fair probability</dt>
              <dd className="text-right font-mono text-slate-800 tabular-nums">
                {fmtPercent(marketProbability(market))}
              </dd>
              <dt className="text-slate-500">Bookmaker</dt>
              <dd className="text-right text-slate-800">
                {market.bookmaker || '—'}
              </dd>
              {showSettlement && (
                <>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-right">
                    <SettlementLabel
                      status={evaluateMarketSettlement(fixture, market)}
                    />
                  </dd>
                </>
              )}
              <dt className="col-span-2 mt-1 text-slate-500">Rationale</dt>
              <dd className="col-span-2 text-slate-700">
                {market.rationale}
              </dd>
            </dl>
          )}
        />
      )}

      {modelRows.length > 0 && (
        <div className="space-y-1.5 border-t border-slate-200 pt-2">
          <p className="text-sm font-semibold text-slate-900">
            Book vs model · 1X2
            {fixture.modelAdvice && (
              <span className="ml-2 font-normal text-slate-500">
                model favours {fixture.modelAdvice}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
            {modelRows.map((row) => (
              <span key={row.label} className="inline-flex items-baseline gap-1.5">
                <span className="font-sans font-medium text-slate-600">
                  {row.label}
                </span>
                <span className="font-semibold text-slate-900">
                  {fmtPercent(row.book, 0)}
                </span>
                <span className="text-slate-300">vs</span>
                <span
                  className={
                    row.model > row.book
                      ? 'font-semibold text-sky-700'
                      : 'text-slate-500'
                  }
                >
                  {fmtPercent(row.model, 0)}
                </span>
              </span>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-slate-600">
            First figure is the de-vigged book price, second is the
            API-Football model. They are shown side by side, never averaged.
          </p>
        </div>
      )}

      {analysisError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{analysisError}</span>
        </div>
      )}

      {deepAnalysis && (
        <div className="space-y-2 border-t border-slate-200 pt-2 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">
            API-Football Predictions &amp; Injury Watch
          </p>
          <p className="leading-relaxed">{deepAnalysis.summary}</p>
          <p>
            <span className="font-semibold text-slate-900">
              Injuries &amp; Absences:{' '}
            </span>
            {deepAnalysis.teamNews}
          </p>
          {deepAnalysis.keyFactors.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-slate-600">
              {deepAnalysis.keyFactors.map((factor, index) => (
                <li key={index}>{factor}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {fixture.pricedAt && (
        <p className="border-t border-slate-200 pt-2 text-xs leading-relaxed text-slate-600">
          Prices captured {formatArchiveTime(fixture.pricedAt)}. Once a match
          kicks off these odds stay frozen unless you explicitly recapture
          them.
        </p>
      )}
    </div>
  );
}
