/**
 * Shared language for the two qualifying-read surfaces:
 *  - the Positive Reads build page (add-to-slip workflow)
 *  - the Analytics "Qualifying reads" tab (research view)
 *
 * Keeping the definition, threshold and caveats here stops the two screens
 * drifting into different vocabularies.
 */
import { researchCopy } from './researchCopy.ts';

/** Minimum inception-to-date ROI (%) for a study cell to be a qualifying read. */
export const POSITIVE_READ_MIN_ROI = 5;

/** Display form of the threshold, used in both screens and the caveats. */
export const POSITIVE_READ_ROI_LABEL = `${POSITIVE_READ_MIN_ROI.toFixed(1)}%`;

/** Canonical heading, matching the Analytics tab label. */
export const POSITIVE_READ_TITLE = 'Qualifying reads';

/** Used only if the response has not supplied its measured universe yet. */
export const POSITIVE_READ_UNIVERSE_LABEL = '3 sections × 5 bands × 18 markets';

interface PositiveReadSurfaceContext {
  strategy: string;
  mode: 'analytics' | 'build';
  source: 'archive' | 'live';
}

/**
 * One-line context strip. Build adds the slip rule because that surface owns
 * the add-to-slip actions; everything else is identical.
 */
export function positiveReadEyebrow({
  strategy,
  mode,
  source,
}: PositiveReadSurfaceContext): string {
  const parts = [
    'Daily feed',
    `${strategy} strategy`,
    source === 'live' ? 'live prices' : 'archived matchday',
  ];
  if (mode === 'build') parts.push('pending picks are kept');
  return parts.join(' · ');
}

/** The shared definition of what makes a fixture appear on either screen. */
export function positiveReadIntroduction(dateLabel: string): string {
  return (
    `Fixtures on ${dateLabel} whose cards hit a section × band × market combination ` +
    `with inception-to-date ROI of ${POSITIVE_READ_ROI_LABEL} or more in the fixed ` +
    'combination study. Each fixture is labelled with the exact qualifying ' +
    'parameter that fired.'
  );
}

/** The one part of the copy that legitimately differs between surfaces. */
export function positiveReadModeNote(mode: 'analytics' | 'build'): string {
  if (mode === 'build') {
    return (
      'Add a labelled card, or use Add all pending picks. Adding a pick copies ' +
      'the displayed price into your slip: Archive uses the frozen pre-match ' +
      'price, Live uses the current book and may drift a band (Band drift). Every ' +
      'pending pick is kept, one per fixture. ' + researchCopy.wideSlip
    );
  }
  return (
    'Archive reviews the selected matchday out of the study, so its labels are ' +
    'out-of-sample; switch to Live for upcoming fixtures. The study and its ' +
    'evidence badges live on the Research tab.'
  );
}

/**
 * Caveats sent with every response. They explain study interpretation only:
 * the threshold, price source and slip rules already appear in the context
 * strip and mode note, so they are not repeated here.
 */
export function positiveReadCaveats(): string[] {
  return [
    `A qualifying read is a section × band × market parameter with inception-to-date ROI of ${POSITIVE_READ_ROI_LABEL} or more in the fixed study. It is descriptive, not proven edge.`,
    `Evidence labels: Qualified needs the matchday-clustered 95% interval to clear zero; Confirmed also cleared ${POSITIVE_READ_ROI_LABEL} in a study ending before this matchday; Stable stayed positive on at least half its matchdays, with at least two matchdays.`,
    'Small-sample parameters can clear the ROI threshold but never earn Qualified or Confirmed status; treat their returns as noise.',
    'Archive labels are out-of-sample for the reviewed matchday. Bands describe the fair probability of the frozen pre-match price, not a guarantee.',
  ];
}
