/**
 * OLX Romania adapter — same Adevinta/Next.js platform as olx.pl.
 * Search URL: https://www.olx.ro/oferte/q-{slug}/
 * Listing URLs: /d/anunt/ (RO uses "anunt" instead of "oferta")
 * Currency: RON (Romanian Leu)
 */

import type { AdapterConfig } from '@sdf/types';
import { OlxAdapter } from '../olx';

const MONTHS_RO: Record<string, number> = {
  ian: 0, ianuarie: 0,
  feb: 1, februarie: 1,
  mar: 2, martie: 2,
  apr: 3, aprilie: 3,
  mai: 4,
  iun: 5, iunie: 5,
  iul: 6, iulie: 6,
  aug: 7, august: 7,
  sep: 8, septembrie: 8,
  oct: 9, octombrie: 9,
  nov: 10, noiembrie: 10,
  dec: 11, decembrie: 11,
};

export class OlxRoAdapter extends OlxAdapter {
  constructor(config: Partial<AdapterConfig> = {}) {
    super(config, {
      source: 'olx_ro',
      baseUrl: 'https://www.olx.ro',
      currency: 'RON',
      searchPath: 'oferte',
      listingUrlFragment: '/d/anunt/',
      shippingPattern: /livrare|curier|transport/i,
      promotedPattern: /promovat/i,
      acceptLanguage: 'ro-RO,ro;q=0.9',
      monthNames: MONTHS_RO,
    });
  }
}
