/**
 * Query matrix for the major-appliance durability harvest.
 *
 * The source adapters are keyword-driven, so "scrape the whole market" means
 * running a seed matrix of {category} ∪ {category × brand} queries per market
 * and de-duplicating the union:
 *   - bare-category queries  → catch long-tail / unbranded / other-brand listings
 *   - category × brand combos → deepen coverage for the brands we score
 *
 * See the study plan: ~/.claude/plans/pure-rolling-sedgewick.md (§3 Data collection).
 */

export type HarvestMarket = 'cz' | 'de';

export interface ApplianceCategory {
  id: string;
  labelEn: string;
  /** Localised search terms per market. terms[0] is the primary term used for brand combos. */
  terms: Record<HarvestMarket, string[]>;
  /**
   * Whether the EU energy label was rescaled on 2021-03-01 for this category.
   * When true, "A+++/A++" vs the new "A/B/C" scale is usable as a coarse
   * pre-/post-2021 vintage band during enrichment (washing machines,
   * dishwashers, fridges). Ovens & dryers were NOT rescaled then.
   */
  energyRescaled2021: boolean;
}

export const CATEGORIES: ApplianceCategory[] = [
  {
    id: 'washing_machine',
    labelEn: 'Washing machine',
    terms: { cz: ['pračka'], de: ['Waschmaschine'] },
    energyRescaled2021: true,
  },
  {
    id: 'dishwasher',
    labelEn: 'Dishwasher',
    terms: { cz: ['myčka'], de: ['Geschirrspüler', 'Spülmaschine'] },
    energyRescaled2021: true,
  },
  {
    id: 'fridge',
    labelEn: 'Fridge / Freezer',
    terms: { cz: ['lednice', 'chladnička'], de: ['Kühlschrank'] },
    energyRescaled2021: true,
  },
  {
    id: 'oven',
    labelEn: 'Oven / Cooker',
    terms: { cz: ['trouba', 'sporák'], de: ['Backofen', 'Herd'] },
    energyRescaled2021: false,
  },
  {
    id: 'dryer',
    labelEn: 'Tumble dryer',
    terms: { cz: ['sušička'], de: ['Wäschetrockner'] },
    energyRescaled2021: false,
  },
];

/** Major-appliance brands present in the CZ/DE markets (~25). */
export const BRANDS: string[] = [
  'Bosch', 'Siemens', 'Miele', 'AEG', 'Electrolux', 'Whirlpool', 'Beko', 'Samsung',
  'LG', 'Gorenje', 'Candy', 'Indesit', 'Zanussi', 'Bauknecht', 'Privileg', 'Hoover',
  'Haier', 'Hisense', 'Sharp', 'Liebherr', 'Mora', 'Philco', 'ETA', 'Concept', 'Romo',
];

/** Top cross-market, high-volume brands used for the pilot harvest. */
export const PILOT_BRANDS: string[] = [
  'Bosch', 'Siemens', 'Miele', 'AEG', 'Electrolux',
  'Whirlpool', 'Beko', 'Samsung', 'LG', 'Gorenje',
];

export interface HarvestQuery {
  market: HarvestMarket;
  categoryId: string;
  /** null = bare category query */
  brand: string | null;
  query: string;
}

export interface BuildMatrixOptions {
  markets?: HarvestMarket[];
  categoryIds?: string[];
  brands?: string[];
  /** include bare category queries (default true) */
  includeBare?: boolean;
}

export function buildQueryMatrix(opts: BuildMatrixOptions = {}): HarvestQuery[] {
  const markets = opts.markets ?? (['cz', 'de'] as HarvestMarket[]);
  const categories = CATEGORIES.filter((c) => !opts.categoryIds || opts.categoryIds.includes(c.id));
  const brands = opts.brands ?? BRANDS;
  const includeBare = opts.includeBare ?? true;

  const queries: HarvestQuery[] = [];
  for (const market of markets) {
    for (const cat of categories) {
      const terms = cat.terms[market];
      if (includeBare) {
        for (const term of terms) {
          queries.push({ market, categoryId: cat.id, brand: null, query: term });
        }
      }
      const primary = terms[0];
      for (const brand of brands) {
        queries.push({ market, categoryId: cat.id, brand, query: `${brand} ${primary}` });
      }
    }
  }
  return queries;
}

/** Pilot scope: washing machines × top-10 brands × CZ+DE (the go/no-go gate). */
export const PILOT_OPTIONS: BuildMatrixOptions = {
  markets: ['cz', 'de'],
  categoryIds: ['washing_machine'],
  brands: PILOT_BRANDS,
  includeBare: true,
};
