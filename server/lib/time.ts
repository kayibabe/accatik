export const CAT_TIMEZONE = 'Africa/Blantyre';

export function getTodayIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatDisplayDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00+02:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: CAT_TIMEZONE,
  });
}

export function formatKickoffCat(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return 'TBD';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${parts} CAT`;
}

export function formatMatchDateCat(
  isoDateTime: string,
  fallbackIsoDate: string
): { matchDate: string; matchDateIso: string } {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) {
    return { matchDate: fallbackIsoDate, matchDateIso: fallbackIsoDate };
  }
  const matchDateIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const matchDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
  return { matchDate, matchDateIso };
}
