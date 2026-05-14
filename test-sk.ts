import { BazosSkAdapter } from './packages/source-adapters/src/bazos-sk/index.ts';
const adapter = new BazosSkAdapter();
try {
  const results = await adapter.searchListings('bicykel');
  console.log('Results:', results.length);
  if (results.length > 0) {
    const r = results[0];
    console.log('Sample:', JSON.stringify({ title: r.title, price: r.price, currency: r.currency, source: r.source }, null, 2));
  } else {
    console.log('No results returned');
  }
} catch(e) {
  console.error('Error:', (e as Error).message);
}
