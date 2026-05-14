import type { AdapterConfig } from '@sdf/types';
import { BazosAdapter } from '../bazos';

export class BazosSkAdapter extends BazosAdapter {
  constructor(config: Partial<AdapterConfig> = {}) {
    super(config, {
      source: 'bazos_sk',
      baseUrl: 'https://www.bazos.sk',
      currency: 'EUR',
      acceptLanguage: 'sk-SK,sk;q=0.9',
    });
  }
}
