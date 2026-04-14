import { NextRequest, NextResponse } from 'next/server';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
};

/** Extract a <meta> tag content by property or name attribute. */
function meta(html: string, attr: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${attr}["'][^>]+content=["']([^"']{1,800})["']` +
    `|<meta[^>]+content=["']([^"']{1,800})["'][^>]+(?:property|name)=["']${attr}["']`,
    'i',
  );
  const m = html.match(pattern);
  const raw = m?.[1] ?? m?.[2] ?? null;
  if (!raw) return null;
  return raw
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim() || null;
}

function extractAukro(html: string): string | null {
  // Aukro uses Angular SSR — try ng-state for item detail data first
  const ngMatch = html.match(/<script id="ng-state"[^>]*>([^<]{1,200000})<\/script>/);
  if (ngMatch) {
    try {
      const state = JSON.parse(ngMatch[1]) as Record<string, unknown>;
      for (const val of Object.values(state)) {
        const v = val as Record<string, unknown>;
        // Item detail shape: { b: { description: "..." } }
        const desc =
          (v?.b as Record<string, unknown>)?.description ??
          v?.description ??
          (v?.item as Record<string, unknown>)?.description;
        if (typeof desc === 'string' && desc.length > 10) return desc;
      }
    } catch {
      // fall through
    }
  }
  return meta(html, 'og:description') ?? meta(html, 'twitter:description');
}

function extractVinted(html: string): string | null {
  // Vinted item pages embed JSON-LD with description, or og:description
  const ldMatch = html.match(/<script type="application\/ld\+json">([^<]{1,50000})<\/script>/g);
  if (ldMatch) {
    for (const block of ldMatch) {
      try {
        const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
        const obj = JSON.parse(inner) as Record<string, unknown>;
        if (typeof obj.description === 'string' && obj.description.length > 5) {
          return obj.description;
        }
      } catch {
        // skip
      }
    }
  }
  return meta(html, 'og:description') ?? meta(html, 'twitter:description');
}

function extractSbazar(html: string): string | null {
  // Sbazar item detail — og:description is reliable
  return (
    meta(html, 'og:description') ??
    meta(html, 'twitter:description') ??
    meta(html, 'description')
  );
}

function extractGeneric(html: string): string | null {
  return meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description');
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const source = req.nextUrl.searchParams.get('source') ?? '';

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  // Basic safety check — only allow known marketplace domains
  const allowed = ['bazos.cz', 'aukro.cz', 'vinted.cz', 'sbazar.cz', 'facebook.com'];
  const isAllowed = allowed.some((d) => url.includes(d));
  if (!isAllowed) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    });

    if (!res.ok) {
      return NextResponse.json({ description: null });
    }

    const html = await res.text();

    let description: string | null;
    if (source === 'aukro') description = extractAukro(html);
    else if (source === 'vinted') description = extractVinted(html);
    else if (source === 'sbazar') description = extractSbazar(html);
    else description = extractGeneric(html);

    return NextResponse.json({ description });
  } catch {
    return NextResponse.json({ description: null });
  }
}
