import { NextRequest, NextResponse } from 'next/server';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
};

function meta(html: string, attr: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${attr}["'][^>]+content=["']([^"']{1,800})["']` +
    `|<meta[^>]+content=["']([^"']{1,800})["'][^>]+(?:property|name)=["']${attr}["']`,
    'i',
  );
  const match = html.match(pattern);
  const raw = match?.[1] ?? match?.[2] ?? null;
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

function extractJsonLdDescription(html: string): string | null {
  const blocks = html.match(/<script type="application\/ld\+json">([^<]{1,50000})<\/script>/g);
  if (!blocks) return null;

  for (const block of blocks) {
    try {
      const payload = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (typeof parsed.description === 'string' && parsed.description.length > 5) {
        return parsed.description;
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }

  return null;
}

function extractGeneric(html: string): string | null {
  return extractJsonLdDescription(html)
    ?? meta(html, 'og:description')
    ?? meta(html, 'twitter:description')
    ?? meta(html, 'description');
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const allowed = [
    'vinted.de',
    'willhaben.at',
    'shpock.com',
  ];
  const isAllowed = allowed.some((domain) => url.includes(domain));
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
    return NextResponse.json({ description: extractGeneric(html) });
  } catch {
    return NextResponse.json({ description: null });
  }
}
