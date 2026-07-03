import { promises as fs } from 'fs';
import path from 'path';

interface AnalysisListingRow {
  brand: string;
  model: string | null;
  source: string;
  seller_type: string;
  fuel_type: string | null;
  transmission: string | null;
  body_type: string | null;
  vehicle_age: number;
  mileage_100k: number | null;
  log_price: number | null;
  defect_indicator: number;
}

const argv = process.argv.slice(2);

function flagValue(flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function readDataset(file: string): Promise<AnalysisListingRow[]> {
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Array<Record<string, unknown>>;
  return raw.map((row) => ({
    brand: String(row.brand),
    model: row.model == null || row.model === '' ? null : String(row.model),
    source: String(row.source),
    seller_type: String(row.seller_type),
    fuel_type: row.fuel_type == null || row.fuel_type === '' ? null : String(row.fuel_type),
    transmission: row.transmission == null || row.transmission === '' ? null : String(row.transmission),
    body_type: row.body_type == null || row.body_type === '' ? null : String(row.body_type),
    vehicle_age: Number(row.vehicle_age),
    mileage_100k: asNumber(row.mileage_100k),
    log_price: asNumber(row.log_price),
    defect_indicator: Number(row.defect_indicator),
  }));
}

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    right[0].map((_, col) =>
      row.reduce((sum, value, idx) => sum + value * right[idx][col], 0),
    ),
  );
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, idx) => sum + value * vector[idx], 0));
}

function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row.map((value) => value),
    ...Array.from({ length: n }, (_, idx) => (idx === rowIndex ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-10) {
      throw new Error('Matrix is singular; regression design is not invertible.');
    }
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

    const pivotValue = augmented[col][col];
    for (let j = 0; j < 2 * n; j += 1) augmented[col][j] /= pivotValue;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = 0; j < 2 * n; j += 1) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  return augmented.map((row) => row.slice(n));
}

function addRidge(matrix: number[][], lambda: number): number[][] {
  return matrix.map((row, rowIndex) =>
    row.map((value, colIndex) => (rowIndex === colIndex ? value + lambda : value)),
  );
}

function uniqueValues(rows: AnalysisListingRow[], selector: (row: AnalysisListingRow) => string | null): string[] {
  return [...new Set(rows.map(selector).filter((value): value is string => !!value))].sort();
}

function buildDesign(
  rows: AnalysisListingRow[],
  dependent: 'log_price' | 'defect_indicator',
): {
  names: string[];
  X: number[][];
  y: number[];
} {
  const validRows = rows.filter((row) =>
    dependent === 'log_price'
      ? row.log_price != null && row.mileage_100k != null
      : row.mileage_100k != null,
  );

  const topBrands = uniqueValues(validRows, (row) => row.brand)
    .sort((a, b) => validRows.filter((row) => row.brand === b).length - validRows.filter((row) => row.brand === a).length)
    .slice(0, 8);
  const brandDummies = topBrands.slice(1);
  const sourceDummies = uniqueValues(validRows, (row) => row.source).slice(1);
  const sellerDummies = uniqueValues(validRows, (row) => row.seller_type).slice(1);
  const fuelDummies = uniqueValues(validRows, (row) => row.fuel_type).slice(1);

  const names = [
    'intercept',
    'vehicle_age',
    'mileage_100k',
    ...brandDummies.map((value) => `brand:${value}`),
    ...sourceDummies.map((value) => `source:${value}`),
    ...sellerDummies.map((value) => `seller:${value}`),
    ...fuelDummies.map((value) => `fuel:${value}`),
  ];

  const X = validRows.map((row) => ([
    1,
    row.vehicle_age,
    row.mileage_100k ?? 0,
    ...brandDummies.map((value) => Number(row.brand === value)),
    ...sourceDummies.map((value) => Number(row.source === value)),
    ...sellerDummies.map((value) => Number(row.seller_type === value)),
    ...fuelDummies.map((value) => Number(row.fuel_type === value)),
  ]));
  const y = validRows.map((row) => dependent === 'log_price' ? row.log_price ?? 0 : row.defect_indicator);

  return { names, X, y };
}

function ols(X: number[][], y: number[]): { coefficients: number[]; method: 'ols' | 'ridge_fallback' } {
  const Xt = transpose(X);
  const XtX = multiplyMatrices(Xt, X);
  let XtXInv: number[][];
  let method: 'ols' | 'ridge_fallback' = 'ols';
  try {
    XtXInv = invert(XtX);
  } catch {
    XtXInv = invert(addRidge(XtX, 1e-6));
    method = 'ridge_fallback';
  }
  const Xty = multiplyMatrixVector(Xt, y);
  return {
    coefficients: multiplyMatrixVector(XtXInv, Xty),
    method,
  };
}

function computeRSquared(X: number[][], y: number[], coefficients: number[]): number {
  const yHat = multiplyMatrixVector(X, coefficients);
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const ssTotal = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const ssResidual = y.reduce((sum, value, idx) => sum + (value - yHat[idx]) ** 2, 0);
  return ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;
}

async function run(): Promise<void> {
  const datasetFile = flagValue('--dataset', path.join(process.cwd(), 'data', 'analysis', 'vehicle_listing_analysis_dataset.json'));
  const outputDir = flagValue('--output-dir', path.join(process.cwd(), 'data', 'analysis'));
  const rows = await readDataset(datasetFile);

  const priceDesign = buildDesign(rows, 'log_price');
  const priceModel = ols(priceDesign.X, priceDesign.y);
  const priceRSquared = computeRSquared(priceDesign.X, priceDesign.y, priceModel.coefficients);

  const defectDesign = buildDesign(rows, 'defect_indicator');
  const defectModel = ols(defectDesign.X, defectDesign.y);
  const defectRSquared = computeRSquared(defectDesign.X, defectDesign.y, defectModel.coefficients);

  const result = {
    dataset: datasetFile,
    price_model: {
      dependent: 'log_price',
      observations: priceDesign.y.length,
      estimation: priceModel.method,
      r_squared: Number(priceRSquared.toFixed(4)),
      coefficients: Object.fromEntries(
        priceDesign.names.map((name, index) => [name, Number(priceModel.coefficients[index].toFixed(6))]),
      ),
    },
    defect_model: {
      dependent: 'defect_indicator',
      observations: defectDesign.y.length,
      estimation: defectModel.method,
      r_squared: Number(defectRSquared.toFixed(4)),
      coefficients: Object.fromEntries(
        defectDesign.names.map((name, index) => [name, Number(defectModel.coefficients[index].toFixed(6))]),
      ),
    },
  };

  await fs.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'first_regression_results.json');
  await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf8');

  console.log('━━━ Vehicle first regressions ━━━');
  console.log(`dataset        : ${datasetFile}`);
  console.log(`price obs      : ${priceDesign.y.length}`);
  console.log(`defect obs     : ${defectDesign.y.length}`);
  console.log(`output         : ${outputFile}`);
}

run().catch((error: unknown) => {
  console.error('[research-vehicles-cz/regressions] fatal error:', error);
  process.exit(1);
});
