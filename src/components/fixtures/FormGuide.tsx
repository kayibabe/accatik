import { FORM_TONE } from '../../utils/uiTone.ts';

interface FormGuideProps {
  /** A form string such as `L-L-D-D-D`, or `—`/empty when unknown. */
  value?: string | null;
  className?: string;
}

/**
 * Colour-coded recent form. Keeps the original `W-D-L` string intact, including
 * its separators, so it still reads the same on cards and in match detail.
 */
export function FormGuide({ value, className = '' }: FormGuideProps) {
  const form = value?.trim();
  if (!form || form === '—') {
    return <span className={`font-mono ${className}`}>—</span>;
  }

  return (
    <span className={`inline-flex items-center font-mono ${className}`}>
      {[...form].map((char, index) => {
        const result = FORM_TONE[char.toUpperCase() as 'W' | 'D' | 'L'];
        if (!result) {
          return (
            <span key={index} className="text-slate-300">
              {char}
            </span>
          );
        }
        return (
          <span
            key={index}
            className={`rounded px-0.5 ${result.className}`}
            title={result.label}
          >
            {char.toUpperCase()}
          </span>
        );
      })}
    </span>
  );
}
