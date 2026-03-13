import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const FEEDS = [
  { url: "https://uxdesign.cc/feed", label: "UX Collective" },
  { url: "https://www.smashingmagazine.com/feed/", label: "Smashing Magazine" },
  { url: "https://vc.ru/rss/all", label: "vc.ru" },
  { url: "https://www.cossa.ru/rss/", label: "Cossa" },
  { url: "https://feeds.feedburner.com/TechCrunch", label: "TechCrunch" },
];

const ITEMS_PER_FEED = 3;
const MAX_CONTEXT_CHARS = 3000;

function parseItems(xml: string) {
  const items: { title: string; pubDate?: string }[] = [];
  const blockRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
  let block;
  while ((block = blockRe.exec(xml)) !== null) {
    const inner = block[1];
    const title = inner.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.trim();
    if (title) items.push({ title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") });
  }
  return items;
}

async function fetchFeed(feed: { url: string; label: string }) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RSSBot/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseItems(xml).slice(0, ITEMS_PER_FEED).map((item) => ({
      source: feed.label,
      title: item.title,
    }));
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const allItems = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((item) => item.title && item.title.length > 10);

    if (!allItems.length) {
      return new Response(JSON.stringify({ context: "", items: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lines = allItems.map((item) => `[${item.source}] ${item.title}`);
    let context = lines.join("\n");
    if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS);

    return new Response(
      JSON.stringify({ context, items: allItems, fetchedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("RSS error:", err);
    return new Response(JSON.stringify({ context: "", items: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
