/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  SOURCE REALITY REPORT — Bazoš (bazos.cz)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 *  Support level: FULL (most reliable source in this app)
 *
 *  Uses plain fetch() — no Playwright required.
 *  Bazoš serves old-school HTML with MIXED attribute quoting:
 *    class="inzeratycena"  ← quoted  (outer container divs)
 *    class=nadpis          ← UNQUOTED (inner h2 / span / div)
 *
 *  Confirmed live structure (April 2026):
 *  <div class="inzeraty inzeratyflex">
 *    <div class="inzeratynadpis">
 *      <a href="URL"><img src="IMG" class="obrazek"></a>
 *      <h2 class=nadpis><a href="URL">TITLE</a></h2>
 *      <span class=velikost10>...[DD.MM. YYYY]...</span>
 *      <div class=popis>DESCRIPTION</div>
 *    </div>
 *    <div class="inzeratycena"><b><span>PRICE Kč</span></b></div>
 *    <div class="inzeratylok">CITY<br>ZIP</div>
 *    <div class="inzeratyview">VIEWS x</div>
 *  </div>
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { AdapterConfig, NormalizedListing, SearchFilters } from '@sdf/types';
import { BaseAdapter } from '../base-adapter';

const BASE_URL = 'https://www.bazos.cz';
const BLOCK_MARKER = 'class="inzeraty inzeratyflex"';
const MAX_BLOCK_LEN = 4_000;

// ─── HTML utilities ───────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/g, '');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Find content of the FIRST element that has `cls` among its (quoted) classes.
 * For elements like class="inzeratycena" or class="inzeratylok".
 */
function extractQuotedClass(html: string, cls: string): string | null {
  const re = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, 'i');
  const m = html.match(re);
  if (!m || m.index == null) return null;
  const tagEnd = html.indexOf('>', m.index);
  if (tagEnd === -1) return null;
  const contentStart = tagEnd + 1;
  const closeIdx = html.indexOf('</', contentStart);
  return closeIdx > contentStart ? html.slice(contentStart, closeIdx) : null;
}

// ─── Block splitter ───────────────────────────────────────────────────────────

function splitIntoBlocks(html: string): string[] {
  const blocks: string[] = [];
  let pos = 0;
  while (true) {
    const start = html.indexOf(BLOCK_MARKER, pos);
    if (start === -1) break;
    const next = html.indexOf(BLOCK_MARKER, start + BLOCK_MARKER.length);
    const end = next === -1 ? Math.min(start + MAX_BLOCK_LEN, html.length) : next;
    blocks.push(html.slice(start, end));
    pos = start + BLOCK_MARKER.length;
  }
  return blocks;
}

// ─── Per-block field extraction ────────────────────────────────────────────────

function parseBlock(block: string): {
  href: string | null;
  title: string | null;
  imageUrl: string | null;
  priceText: string | null;
  location: string | null;
  dateText: string | null;
  description: string | null;
  viewsText: string | null;
  isPromoted: boolean;
} {
  // Title + href: <h2 class=nadpis><a href="URL">TITLE</a></h2>
  const nadpisMatch = block.match(/class=nadpis[^>]*>[\s\S]*?<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const href = nadpisMatch?.[1] ?? null;
  const title = nadpisMatch ? stripTags(nadpisMatch[2]) : null;

  // Image: first <img> inside class="inzeratynadpis"
  const imgChunk = extractQuotedClass(block, 'inzeratynadpis') ?? block.slice(0, 800);
  const imgMatch = imgChunk.match(/<img[^>]+src="([^"]+)"/i);
  const imageUrl = imgMatch?.[1] ?? null;

  // Price: class="inzeratycena"
  const priceRaw = extractQuotedClass(block, 'inzeratycena');
  const priceText = priceRaw ? stripTags(priceRaw) : null;

  // Location: class="inzeratylok" (city on first line, zip on second)
  const locRaw = extractQuotedClass(block, 'inzeratylok');
  const location = locRaw ? stripTags(locRaw.split('<br')[0]) || null : null;

  // Date: extract [DD.MM. YYYY] pattern directly from the block (avoids
  // nested-span issues inside class=velikost10)
  const dateBracket = block.match(/\[(\d{1,2}\.\d{1,2}\.?\s*\d{4})\]/);
  const dateText = dateBracket ? `[${dateBracket[1]}]` : null;

  // Description: <div class=popis>...</div> — stop at </div>
  const descMatch = block.match(/class=popis[^>]*>([\s\S]*?)<\/div>/i);
  const description = descMatch ? stripTags(descMatch[1]) || null : null;

  // Views: class="inzeratyview"
  const viewsRaw = extractQuotedClass(block, 'inzeratyview');
  const viewsText = viewsRaw ? stripTags(viewsRaw) : null;

  // Promoted: class="ztop" present
  const isPromoted = /class="ztop"/.test(block);

  return { href, title, imageUrl, priceText, location, dateText, description, viewsText, isPromoted };
}

export class BazosAdapter extends BaseAdapter {
  source = 'bazos' as const;
  supportLevel = 'full' as const;

  constructor(config: Partial<AdapterConfig> = {}) {
    super(config);
  }

  buildSearchUrl(query: string, filters?: SearchFilters, start = 0): string {
    const params = new URLSearchParams({
      hledat: query,
      rubriky: '',
      hlokalita: filters?.location ?? '',
      humkreis: String(filters?.locationRadius ?? 25),
      cenaod: filters?.priceMin != null ? String(filters.priceMin) : '',
      cenado: filters?.priceMax != null ? String(filters.priceMax) : '',
      Submit: 'Hledat',
      kitx: 'ano',
    });
    if (start > 0) params.set('start', String(start));
    return `${BASE_URL}/search.php?${params.toString()}`;
  }

  async searchListings(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    return this.withRetry(
      () => this._fetch(query, filters),
      'bazos.search',
    );
  }

  private async _fetch(
    query: string,
    filters?: SearchFilters,
  ): Promise<NormalizedListing[]> {
    // Fetch 5 pages sequentially to avoid duplicate-page detection issues
    // Bazoš paginates via &start=N (20 per page → up to 100 results)
    const urls = [0, 20, 40, 60, 80].map((start) => this.buildSearchUrl(query, filters, start));
    this.log(`Fetching ${urls.length} pages in parallel`);

    const htmlPages = await Promise.all(
      urls.map((url) => this.fetchHtml(url).catch((err) => {
        this.log(`Page fetch failed: ${(err as Error).message}`);
        return '';
      })),
    );

    const results: NormalizedListing[] = [];
    const seenIds = new Set<string>();

    for (let p = 0; p < htmlPages.length; p++) {
      const html = htmlPages[p];
      if (!html) continue;

      const blocks = splitIntoBlocks(html);
      this.log(`Page ${p}: found ${blocks.length} blocks`);

      for (const block of blocks) {
        const { href, title, imageUrl, priceText, location, dateText, description, viewsText, isPromoted } = parseBlock(block);

        if (!href || !title) continue;

        const listingId = this.extractListingId(href);
        if (!listingId || seenIds.has(listingId)) continue;
        seenIds.add(listingId);

        const price = this.parseBazosPrice(priceText);
        const conditionSource =
          this.inferConditionFromTitle(title) ??
          this.inferConditionFromTitle(description ?? '');

        results.push({
          id: this.makeId(listingId),
          source: 'bazos',
          sourceListingId: listingId,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          title,
          description,
          price,
          currency: 'CZK',
          location,
          postedAt: this.parseBazosDate(dateText),
          conditionText: conditionSource,
          condition: this.inferCondition(conditionSource),
          imageCount: imageUrl ? 1 : 0,
          imageUrl: this.resolveImageUrl(imageUrl),
          sellerName: null,
          sellerRating: null,
          sellerReviewCount: null,
          views: this.parseViews(viewsText),
          likes: null,
          shippingAvailable: null,
          promoted: isPromoted,
          rawMetadata: { priceText, location, dateText, viewsText },
        });
      }

      // If fewer than 20 on the first page, skip remaining pages
      if (p === 0 && blocks.length < 20) break;
    }

    this.log(`Total unique results: ${results.length}`);
    return results;
  }

  private async fetchHtml(url: string): Promise<string> {
    this.log(`Fetching: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'cs-CZ,cs;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });
    if (!res.ok) throw new Error(`Bazoš HTTP ${res.status} for ${url}`);
    return res.text();
  }

  private extractListingId(href: string): string | null {
    const match = href.match(/\/(\d{6,})\//);
    return match?.[1] ?? null;
  }

  private parseBazosPrice(text: string | null): number | null {
    if (!text) return null;
    if (/dohodou|zdarma|free/i.test(text)) return null;
    return this.safePrice(text);
  }

  private inferConditionFromTitle(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();

    if (/v záruční době|v záruce|záruční|zapečetěný|zapečetěná/.test(lower)) return 'v záruce';
    if (/nerozbalený|nerozbalená|nerozbalené|sealed|boxed/.test(lower)) return 'nerozbalený';
    if (/\bnový\b|\bnová\b|\bnové\b|nepoužitý|nepoužitá|nepoužité|\bnew\b|brand new/.test(lower)) return 'nový';
    if (/jako nový|jako nová|jako nové|stav jako nový/.test(lower)) return 'jako nový';
    if (/zánovní|zánovni/.test(lower)) return 'zánovní';
    if (/téměř nový|téměř nová|skoro nový|skoro nová/.test(lower)) return 'téměř nový';
    if (/bezvadný stav|bezvadný|skvělý stav|top stav/.test(lower)) return 'výborný stav';
    if (/výborný stav|perfektní stav|perfektní kondice|výborná kondice/.test(lower)) return 'výborný stav';
    if (/\bperfektní\b|\bvýborný\b|\bvýborná\b/.test(lower)) return 'výborný stav';
    if (/\bmint\b|mint condition|lightly used|barely used/.test(lower)) return 'jako nový';
    if (/plně funkční|funkční stav|bez závad|bez problémů|bez vad/.test(lower)) return 'dobrý stav';
    if (/hezký stav|pěkný stav|zachovalý stav/.test(lower)) return 'dobrý stav';
    if (/dobrý stav|dobrá kondice/.test(lower)) return 'dobrý stav';
    if (/zachovalý|zachovalá|zachovalé/.test(lower)) return 'dobrý stav';
    if (/\bfunkční\b/.test(lower)) return 'dobrý stav';
    if (/drobné škrábance|drobné poškrábání|lehce poškrábané|stopy použití|stopy opotřebení/.test(lower)) return 'drobné škrábance';
    if (/kosmetické vady|kosmetická vada|viditelné opotřebení/.test(lower)) return 'drobné škrábance';
    if (/lehce poškozený|lehce poškozená|lehce opotřebovaný/.test(lower)) return 'drobné škrábance';
    if (/opotřebovaný|opotřebovaná|opotřebované/.test(lower)) return 'opotřebovaný';
    if (/na díly|na náhradní díly|ke opravě|potřebuje opravu|potřebuje servis/.test(lower)) return 'na díly';
    if (/nefunkční displej|rozbitý displej|prasklý displej|popraskané sklo|rozbité sklo/.test(lower)) return 'poškozený';
    if (/poškozený|poškozená|poškozené/.test(lower)) return 'poškozený';
    if (/nefunkční|rozbité|rozbitý|rozbitá|prasklé|prasklý/.test(lower)) return 'nefunkční';

    return null;
  }

  private resolveImageUrl(src: string | null): string | null {
    if (!src) return null;
    if (src.startsWith('http')) return src;
    if (src.startsWith('//')) return `https:${src}`;
    return `${BASE_URL}${src}`;
  }

  private parseBazosDate(text: string | null): Date | null {
    if (!text) return null;
    const match = text.match(/\[(\d{1,2})\.(\d{1,2})\.?\s*(\d{4})\]/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return this.parseCzechRelativeDate(text);
  }

  private parseViews(text: string | null): number | null {
    if (!text) return null;
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  detectPromoted(raw: Record<string, unknown>): boolean {
    return raw.isPromoted === true || raw.isPromoted === 'true';
  }

  extractSellerSignals(_raw: Record<string, unknown>) {
    return { sellerName: null, sellerRating: null, sellerReviewCount: null };
  }
}
