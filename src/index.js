const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { z } = require('zod');

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────
const BASE = 'https://books.toscrape.com';
const CATALOGUE_PAGES = [
  `${BASE}/catalogue/page-1.html`,
  `${BASE}/catalogue/page-2.html`,
  `${BASE}/catalogue/page-3.html`
];
const USER_AGENT = 'FlyRankInternship-A9/1.0 (+https://github.com/Asgharraza/scraper)';
const DELAY_MS = 600;
const TIMEOUT_MS = 10000;
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cachePath(url) {
  const safe = url.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(CACHE_DIR, `${safe}.html`);
}

async function fetchWithCache(url, stats) {
  const file = cachePath(url);

  if (fs.existsSync(file)) {
    stats.cache_hits++;
    return fs.readFileSync(file, 'utf8');
  }

  stats.pages_fetched++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const html = await res.text();
  fs.writeFileSync(file, html);
  await sleep(DELAY_MS);
  return html;
}

// ─────────────────────────────────────────
// Schema
// ─────────────────────────────────────────
const BookSchema = z.object({
  title: z.string(),
  product_url: z.string().url(),
  price_text: z.string(),
  price_gbp: z.number(),
  availability_text: z.string(),
  rating_text: z.string(),
  description: z.string().nullable(),
  source_page: z.string().url(),
  fetched_at: z.string()
});

// ─────────────────────────────────────────
// Stage 2: discover book URLs across 3 pages
// ─────────────────────────────────────────
async function discoverBooks(stats) {
  const urls = new Set();
  const sourcePageMap = {};

  for (const pageUrl of CATALOGUE_PAGES) {
    const html = await fetchWithCache(pageUrl, stats);
    const $ = cheerio.load(html);
    $('article.product_pod h3 a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const absolute = new URL(href, pageUrl).toString();
      if (!urls.has(absolute)) {
        urls.add(absolute);
        sourcePageMap[absolute] = pageUrl;
      }
    });
  }

  return { urls: [...urls], sourcePageMap };
}

// ─────────────────────────────────────────
// Stage 3: extract raw fields from a book page
// ─────────────────────────────────────────
function extractBook(html, productUrl, sourcePage) {
  const $ = cheerio.load(html);
  const productArea = $('.product_main');

  const title = productArea.find('h1').text().trim();

  const priceText = productArea.find('.price_color').first().text().trim();
  const priceClean = priceText.replace(/[^0-9.]/g, '');

  const availabilityText = productArea.find('.availability').text().trim().replace(/\s+/g, ' ');

  const ratingClass = productArea.find('.star-rating').attr('class') || '';
  const ratingText = ratingClass.replace('star-rating', '').trim() || null;

  const descEl = $('#product_description').next('p');
  const description = descEl.length ? descEl.text().trim() : null;

  return {
    title,
    product_url: productUrl,
    price_text: priceClean,
    availability_text: availabilityText,
    rating_text: ratingText,
    description,
    source_page: sourcePage,
    fetched_at: new Date().toISOString()
  };
}

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const stats = {
    pages_fetched: 0,
    cache_hits: 0,
    valid_records: 0,
    invalid_records: 0,
    failed_pages: 0
  };

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Stage 2
  const { urls, sourcePageMap } = await discoverBooks(stats);
  console.log(`catalogue_pages=${CATALOGUE_PAGES.length}, discovered=${urls.length}, unique_urls=${urls.length}`);

  // Optional: fake URL to test Stage 5 — uncomment to prove failure handling
  // urls.push('https://books.toscrape.com/catalogue/this-book-does-not-exist_9999/index.html');

  const valid = [];
  const errors = [];
  const seen = new Set();

  for (const url of urls) {
    try {
      const html = await fetchWithCache(url, stats);
      const raw = extractBook(html, url, sourcePageMap[url]);

      // Stage 4: normalize
      const normalized = {
        ...raw,
        price_gbp: parseFloat(raw.price_text)
      };

      // Dedupe by canonical URL
      if (seen.has(normalized.product_url)) continue;
      seen.add(normalized.product_url);

      // Validate
      const parsed = BookSchema.safeParse(normalized);
      if (parsed.success) {
        valid.push(parsed.data);
        stats.valid_records++;
      } else {
        errors.push({ url, reason: parsed.error.issues[0].message });
        stats.invalid_records++;
      }
    } catch (err) {
      console.error(`FAILED: ${url} — ${err.message}`);
      errors.push({ url, reason: err.message });
      stats.failed_pages++;
    }
  }

  // Write output
  fs.writeFileSync(path.join(OUTPUT_DIR, 'books.json'), JSON.stringify(valid, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'errors.json'), JSON.stringify(errors, null, 2));

  const report = {
    start_time: new Date(startTime).toISOString(),
    duration_ms: Date.now() - startTime,
    ...stats,
    total_urls_discovered: urls.length
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'run-report.json'), JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});