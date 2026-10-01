# Polite Scraper — Books to Scrape (A9)

A small, polite scraping pipeline that downloads 3 catalogue pages from
[Books to Scrape](https://books.toscrape.com/), visits all 60 book pages,
normalizes the raw HTML into clean JSON, validates against a schema, and
writes an honest run report.

## Target classification

- **Site:** https://books.toscrape.com/
- **Why:** Books to Scrape is a public practice sandbox built specifically for
  learning scraping. Their site states it exists so people can practice.
- **Scope:** the first **3 catalogue pages only** (60 books).
- **Data collected:** title, product URL, price, availability, rating,
  description, source page, fetch time.
- **Robots check:** requested `https://books.toscrape.com/robots.txt` — no robots file found.
- **Ethics:** I will not reuse this code on another site without checking its rules and terms first.

## Install & Run

```bash
npm install
node src/index.js