/**
 * League prestige ranking shared by the fixture sort and the acca builder.
 * Lower is better; 100 means "unranked".
 */
const PRIORITY_LEAGUES = [
  'World Cup',
  'UEFA Nations League',
  'UEFA Champions League',
  'UEFA Europa League',
  'UEFA Conference League',
  'Premier League',
  'La Liga',
  'Bundesliga',
  'Serie A',
  'Ligue 1',
  'Championship',
  'League One',
  'League Two',
  'Segunda División',
  'Serie B',
  'Primeira Liga',
  'Eredivisie',
  'Major League Soccer',
  'MLS',
  'Brasileirão',
  'Africa Cup of Nations',
  'CAF Champions League',
  'CONCACAF',
  'FA Cup',
  'Copa Libertadores',
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function getLeaguePriority(leagueName: string, country: string): number {
  const league = normalize(leagueName);

  // Prefer an exact league-name match so "Serie B" never ranks as "Serie A"
  // and women's/youth variants of a top league rank below the senior competition.
  for (let i = 0; i < PRIORITY_LEAGUES.length; i++) {
    if (league === normalize(PRIORITY_LEAGUES[i])) return i;
  }

  const isVariant = /\b(women|womens|u\d{2}|youth|reserves?|ii)\b/.test(league);
  for (let i = 0; i < PRIORITY_LEAGUES.length; i++) {
    if (league.includes(normalize(PRIORITY_LEAGUES[i]))) {
      return isVariant ? i + 0.5 : i;
    }
  }

  if (country === 'World' || country === 'Europe') return 15;
  return 100;
}
