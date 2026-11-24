import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SCOPE_META, type PageScope } from '../../utils/uiTone.ts';

interface BackToSlateButtonProps {
  onClick: () => void;
  label?: string;
  variant?: 'primary' | 'secondary';
}

/** The single canonical "return to the matchday" action. */
export function BackToSlateButton({
  onClick,
  label = "Back to Today's Slate",
  variant = 'primary',
}: BackToSlateButtonProps) {
  const className =
    variant === 'primary'
      ? 'px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer'
      : 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer';

  return (
    <button type="button" onClick={onClick} className={className}>
      {variant === 'secondary' && (
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

export function ScopeBadge({ scope }: { scope: PageScope }) {
  const meta = SCOPE_META[scope];
  return (
    <span
      title={meta.description}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  scope?: PageScope;
  /** Extra small meta shown under the title, e.g. strategy and date. */
  meta?: ReactNode;
  /** Optional override for the description wrapper. */
  descriptionClassName?: string;
}

/**
 * Shared page shell for every secondary view. Keeps eyebrow, heading, scope,
 * meta and actions in the same place so views only supply their own content.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  onBack,
  backLabel,
  scope,
  meta,
  descriptionClassName = 'max-w-3xl',
}: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {(eyebrow || scope) && (
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow && (
              <p className="text-xs font-medium text-slate-500">{eyebrow}</p>
            )}
            {scope && <ScopeBadge scope={scope} />}
          </div>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {meta && <div className="text-xs text-slate-500">{meta}</div>}
        {description && (
          <p
            className={`text-xs leading-relaxed text-slate-600 ${descriptionClassName}`}
          >
            {description}
          </p>
        )}
      </div>
      {(actions || onBack) && (
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {actions}
          {onBack && (
            <BackToSlateButton onClick={onBack} label={backLabel} />
          )}
        </div>
      )}
    </div>
  );
}
