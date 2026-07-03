/**
 * Query matrix for the Czech passenger-vehicle durability study.
 *
 * The current repo does not yet have dedicated car-portal adapters. v1
 * therefore reuses the generic Czech marketplace adapters already present in
 * the codebase and drives them with a brand/model query matrix. This is enough
 * for a proof-of-concept snapshot and for testing the enrichment pipeline, but
 * the final paper should add at least one structured auto source.
 */

export type HarvestMarket = 'cz';
export type QueryKind = 'brand' | 'model';

export interface VehicleBrandSeed {
  brand: string;
  aliases?: string[];
  models: string[];
}

export interface VehicleHarvestQuery {
  market: HarvestMarket;
  kind: QueryKind;
  brand: string;
  model: string | null;
  query: string;
}

export interface BuildMatrixOptions {
  brands?: string[];
  includeBrandQueries?: boolean;
  includeModelQueries?: boolean;
  maxModelsPerBrand?: number;
}

export const VEHICLE_BRANDS: VehicleBrandSeed[] = [
  { brand: 'Skoda', aliases: ['Škoda'], models: ['Octavia', 'Fabia', 'Superb', 'Kodiaq', 'Karoq'] },
  { brand: 'Volkswagen', models: ['Golf', 'Passat', 'Polo', 'Tiguan', 'Touran'] },
  { brand: 'Ford', models: ['Focus', 'Mondeo', 'Fiesta', 'Kuga', 'S-Max'] },
  { brand: 'Hyundai', models: ['i30', 'Tucson', 'i20', 'ix35', 'Santa Fe'] },
  { brand: 'Toyota', models: ['Corolla', 'Yaris', 'RAV4', 'Auris', 'Avensis'] },
  { brand: 'BMW', models: ['320', '520', 'X3', 'X5', '118'] },
  { brand: 'Mercedes-Benz', aliases: ['Mercedes'], models: ['C 220', 'E 220', 'GLC', 'A 180', 'Vito'] },
  { brand: 'Audi', models: ['A3', 'A4', 'A6', 'Q5', 'Q7'] },
  { brand: 'Renault', models: ['Clio', 'Megane', 'Captur', 'Scenic', 'Kadjar'] },
  { brand: 'Peugeot', models: ['208', '308', '3008', '508', '2008'] },
  { brand: 'Kia', models: ['Ceed', 'Sportage', 'Rio', 'Sorento', 'Picanto'] },
  { brand: 'Opel', models: ['Astra', 'Corsa', 'Insignia', 'Mokka', 'Zafira'] },
  { brand: 'Dacia', models: ['Duster', 'Sandero', 'Logan', 'Dokker', 'Lodgy'] },
];

export const PILOT_BRANDS = ['Skoda', 'Volkswagen', 'Ford', 'Hyundai', 'Toyota'];

export function buildQueryMatrix(opts: BuildMatrixOptions = {}): VehicleHarvestQuery[] {
  const requestedBrands = new Set((opts.brands ?? VEHICLE_BRANDS.map((item) => item.brand)).map((brand) => brand.toLowerCase()));
  const includeBrandQueries = opts.includeBrandQueries ?? false;
  const includeModelQueries = opts.includeModelQueries ?? true;
  const maxModelsPerBrand = opts.maxModelsPerBrand ?? 0;

  const queries: VehicleHarvestQuery[] = [];

  for (const seed of VEHICLE_BRANDS) {
    if (!requestedBrands.has(seed.brand.toLowerCase())) continue;

    if (includeBrandQueries) {
      queries.push({
        market: 'cz',
        kind: 'brand',
        brand: seed.brand,
        model: null,
        query: `${seed.brand} auto`,
      });
    }

    if (!includeModelQueries) continue;

    const models = maxModelsPerBrand > 0 ? seed.models.slice(0, maxModelsPerBrand) : seed.models;
    for (const model of models) {
      queries.push({
        market: 'cz',
        kind: 'model',
        brand: seed.brand,
        model,
        query: `${seed.brand} ${model}`,
      });
    }
  }

  return queries;
}

export const PILOT_OPTIONS: BuildMatrixOptions = {
  brands: PILOT_BRANDS,
  includeBrandQueries: false,
  includeModelQueries: true,
  maxModelsPerBrand: 2,
};
