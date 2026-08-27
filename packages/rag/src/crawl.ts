import * as cheerio from "cheerio";
import pLimit from "p-limit";

export interface CrawlOptions {
  maxPages?: number;
  concurrency?: number;
  /** Restrict to same-origin links unless explicit URLs are given. */
  sameOriginOnly?: boolean;
  /** Per-request timeout in ms — a single hung page must never stall a whole crawl. */
  requestTimeoutMs?: number;
  /** Respect the origin's robots.txt Disallow rules. Default true. */
  respectRobotsTxt?: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

const USER_AGENT = "AIChatAgentPlatform-KnowledgeCrawler/1.0";

function extractReadableText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, svg").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim() || "Untitled";
  const text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      if (resolved.origin === origin) links.add(resolved.toString());
    } catch {
      // ignore malformed hrefs
    }
  });
  return [...links];
}

/**
 * Drops the URL fragment (already gone by the time we get here) and common
 * tracking query params, and strips a lone trailing slash — collapses
 * near-duplicate URLs (`/shop?utm_source=x` vs `/shop`, `/about/` vs
 * `/about`) that would otherwise burn two slots out of `maxPages` on
 * effectively the same page.
 */
const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref"]);
function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hash = "";
  let normalized = url.toString();
  if (normalized.endsWith("/") && url.pathname !== "/") normalized = normalized.slice(0, -1);
  return normalized;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Minimal robots.txt parser — enough to honor `Disallow` rules for our own
 * user-agent (falling back to `*`), which is the actual politeness
 * contract crawlers are expected to respect. Not a full RFC 9309
 * implementation (no `Allow` precedence rules, no `Crawl-delay`) — those
 * refinements can come later if a real site needs them.
 */
async function loadDisallowedPaths(origin: string, timeoutMs: number): Promise<string[]> {
  try {
    const resp = await fetchWithTimeout(`${origin}/robots.txt`, timeoutMs);
    if (!resp.ok) return [];
    const body = await resp.text();
    const disallowed: string[] = [];
    let applies = false;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.split("#")[0]!.trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey!.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*" || value.toLowerCase() === USER_AGENT.toLowerCase();
      } else if (key === "disallow" && applies && value) {
        disallowed.push(value);
      }
    }
    return disallowed;
  } catch {
    // robots.txt missing/unreachable is not a reason to refuse to crawl —
    // treat it the same as "no restrictions specified."
    return [];
  }
}

function isDisallowed(path: string, disallowedPrefixes: string[]): boolean {
  return disallowedPrefixes.some((prefix) => path.startsWith(prefix));
}

/**
 * Discovers additional URLs from a sitemap (CLAUDE.md's "selected pages or
 * sitemap ingestion") — tried at `${origin}/sitemap.xml` when the caller
 * hasn't already pointed at one explicitly. A sitemap index (a sitemap of
 * sitemaps) is expanded one level deep, which covers the common case
 * without unbounded recursion.
 */
async function discoverSitemapUrls(origin: string, timeoutMs: number): Promise<string[]> {
  async function fetchSitemap(url: string): Promise<{ urls: string[]; sitemaps: string[] }> {
    try {
      const resp = await fetchWithTimeout(url, timeoutMs);
      if (!resp.ok) return { urls: [], sitemaps: [] };
      const xml = await resp.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      const urls = $("urlset > url > loc").map((_, el) => $(el).text().trim()).get();
      const sitemaps = $("sitemapindex > sitemap > loc").map((_, el) => $(el).text().trim()).get();
      return { urls, sitemaps };
    } catch {
      return { urls: [], sitemaps: [] };
    }
  }

  const root = await fetchSitemap(`${origin}/sitemap.xml`);
  if (root.urls.length > 0) return root.urls;
  if (root.sitemaps.length === 0) return [];

  const nested = await Promise.all(root.sitemaps.slice(0, 20).map((sm) => fetchSitemap(sm)));
  return nested.flatMap((n) => n.urls);
}

/**
 * Website crawling ingestion source (CLAUDE.md's "selected pages or
 * sitemap ingestion"). Callers pass explicit `startUrls` (selected pages)
 * — this function seeds the queue with those, auto-discovers a sitemap for
 * the same origin to fill in pages link-following alone might miss, then
 * does breadth-first same-origin crawling bounded by maxPages, never an
 * unbounded spider. A per-request timeout keeps one hung page from
 * stalling a whole concurrency slot, and robots.txt Disallow rules are
 * honored by default.
 */
export async function crawlPages(startUrls: string[], options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const maxPages = options.maxPages ?? 50;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const respectRobotsTxt = options.respectRobotsTxt ?? true;
  const limit = pLimit(options.concurrency ?? 4);
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];

  if (startUrls.length === 0) return pages;
  const origin = new URL(startUrls[0]!).origin;

  const disallowedPrefixes = respectRobotsTxt ? await loadDisallowedPaths(origin, requestTimeoutMs) : [];
  const sitemapUrls = options.sameOriginOnly === false ? [] : await discoverSitemapUrls(origin, requestTimeoutMs);

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const raw of [...startUrls, ...sitemapUrls]) {
    try {
      const normalized = normalizeUrl(raw);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        queue.push(normalized);
      }
    } catch {
      // malformed seed URL — skip rather than fail the whole crawl
    }
  }

  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.max(1, maxPages - visited.size));
    const results = await Promise.all(
      batch.map((url) =>
        limit(async () => {
          if (visited.has(url)) return null;
          visited.add(url);
          if (isDisallowed(new URL(url).pathname, disallowedPrefixes)) return null;
          try {
            const resp = await fetchWithTimeout(url, requestTimeoutMs);
            if (!resp.ok) return null;
            const contentType = resp.headers.get("content-type") ?? "";
            if (!contentType.includes("text/html")) return null;
            const html = await resp.text();
            const { title, text } = extractReadableText(html);
            const links = options.sameOriginOnly === false ? [] : extractLinks(html, url);
            return { page: { url, title, text } as CrawledPage, links };
          } catch {
            return null;
          }
        }),
      ),
    );

    for (const result of results) {
      if (!result) continue;
      pages.push(result.page);
      for (const rawLink of result.links) {
        let link: string;
        try {
          link = normalizeUrl(rawLink);
        } catch {
          continue;
        }
        if (!seen.has(link)) {
          seen.add(link);
          queue.push(link);
        }
      }
    }
  }

  return pages;
}
