export interface ModelComparisonRow {
  label: string;
  book: number;
  model: number;
}

export interface FixtureFacetCounts {
  angles: Record<string, number>;
  covers: Record<string, number>;
  notes: Record<string, number>;
  marketTypes: Record<string, number>;
  selections: Record<string, number>;
  modelEdges: Record<number, number>;
}
