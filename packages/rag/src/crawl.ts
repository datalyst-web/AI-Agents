import * as cheerio from "cheerio";
import pLimit from "p-limit";

export interface CrawlOptions {
  maxPages?: number;
  concurrency?: number;
  /** Restrict to same-origin links unless explicit URLs are given. */
  sameOriginOnly?: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

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
 * Website crawling ingestion source (CLAUDE.md's "selected pages or
 * sitemap ingestion"). Callers pass either explicit `startUrls` (selected
 * pages) or a sitemap-derived URL list — this function does breadth-first
 * same-origin crawling bounded by maxPages, never an unbounded spider.
 */
export async function crawlPages(startUrls: string[], options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const maxPages = options.maxPages ?? 50;
  const limit = pLimit(options.concurrency ?? 4);
  const visited = new Set<string>();
  const queue = [...startUrls];
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.max(1, maxPages - visited.size));
    const results = await Promise.all(
      batch.map((url) =>
        limit(async () => {
          if (visited.has(url)) return null;
          visited.add(url);
          try {
            const resp = await fetch(url, { headers: { "user-agent": "AIChatAgentPlatform-KnowledgeCrawler/1.0" } });
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
      for (const link of result.links) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }
  }

  return pages;
}
