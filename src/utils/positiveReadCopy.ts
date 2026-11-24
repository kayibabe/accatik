/**
 * Shared language for the two qualifying-read surfaces:
 *  - the Positive Reads build page (add-to-slip workflow)
 *  - the Analytics "Qualifying reads" tab (research view)
 *
 * Keeping the definition, threshold and caveats here stops the two screens
 * drifting into different vocabularies.
 */

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
      'Add a labelled card, or use Add all pending picks. Archive uses the frozen ' +
      'pre-match price; Live uses the current book and may drift a band. Every ' +
      'pending pick is kept, one per fixture. Wide slips are research only, not ' +
      'recommendations.'
    );
  }
  return (
    'Archive reviews the selected matchday out of the study, so its labels are ' +
    'out-of-sample; switch to Live for upcoming fixtures. The study and its ' +
    'evidence badges live on the Research tab.'
  );
}

/** Caveats sent with every response, so both surfaces disclose the same rules. */
export function positiveReadCaveats(): string[] {
  return [
    `A qualifying read is a section × band × market parameter whose inception-to-date ROI is ${POSITIVE_READ_ROI_LABEL} or more in the combination study. It is descriptive, not proven edge.`,
    `Qualified parameters need the matchday-clustered 95% interval to clear zero; Confirmed parameters also cleared the ${POSITIVE_READ_ROI_LABEL} threshold in a study that stops before this one’s latest matchday.`,
    'Stable means a qualified parameter was also positive on at least half the matchdays it appeared on, with a minimum of two, so one large win cannot carry the read.',
    'Parameters below the study’s minimum sample are still shown when they clear the qualifying ROI threshold, and are badged as small samples; they can never be Qualified or Confirmed.',
    `Archive reviews leave the reviewed matchday out of the study, so labels are out-of-sample for that day. The study is the fixed ${POSITIVE_READ_UNIVERSE_LABEL} universe, not a per-market promotion.`,
    'Bands are the engine’s confidence label for the fair probability of the frozen pre-match price, not a guarantee of the outcome.',
    'Live mode prices a card from the current book, so its band can differ from the archived price that produced the study. A Band drift badge marks a fixture made by section and market instead of the exact band.',
    'Adding a pending pick copies the price shown here into your slip. Archive uses the frozen pre-match price; switch to Live for the current book.',
  ];
}
