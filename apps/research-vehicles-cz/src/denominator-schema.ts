export interface RegistrationDenominatorRow {
  brand: string;
  model: string | null;
  cohortYear: number;
  registrations: number;
}

export interface ActiveStockDenominatorRow {
  brand: string;
  model: string | null;
  cohortYear: number;
  activeStock: number;
}

export function normalizeKeyPart(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function denominatorKey(brand: string, model: string | null, cohortYear: number): string {
  return `${normalizeKeyPart(brand)}|||${normalizeKeyPart(model)}|||${cohortYear}`;
}

export function denominatorKeyBrandOnly(brand: string, cohortYear: number): string {
  return `${normalizeKeyPart(brand)}|||${cohortYear}`;
}
