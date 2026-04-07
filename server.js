const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const parser = new Parser();

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const placeholder =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Reuters_Logo.svg/200px-Reuters_Logo.svg.png';

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================================
// Helper: Extract best image
// ================================
async function fetchOGImage(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 4000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);

    const candidates = [
      $('meta[property="og:image"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content'),
      $('article img').first().attr('src'),
      $('img').first().attr('src')
    ];

    const img = candidates.find(src => src && src.startsWith('http'));
    return img || placeholder;
  } catch (err) {
    console.warn(`⚠️ Failed image fetch for ${url}: ${err.message}`);
    return placeholder;
  }
}

// ================================
// MEDIUM (RSS by tag)
// ================================
async function scrapeMediumConspiracy() {
  try {
    const feed = await parser.parseURL('https://medium.com/feed/tag/conspiracy');

    const articles = feed.items.slice(0, 10).map(item => ({
      source: 'Medium Conspiracy',
      title: item.title,
      link: item.link,
      thumbnail:
        item.enclosure?.url ||
        item['media:thumbnail']?.url ||
        placeholder
    }));

    console.log('📰 Medium Conspiracy:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ Medium Conspiracy error:', err.message);
    return [];
  }
}

async function scrapeMediumParanormal() {
  try {
    const feed = await parser.parseURL('https://medium.com/feed/tag/paranormal');

    const articles = feed.items.slice(0, 10).map(item => ({
      source: 'Medium Paranormal',
      title: item.title,
      link: item.link,
      thumbnail:
        item.enclosure?.url ||
        item['media:thumbnail']?.url ||
        placeholder
    }));

    console.log('📰 Medium Paranormal:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ Medium Paranormal error:', err.message);
    return [];
  }
}

// ================================
// LIVE SCIENCE (RSS)
// ================================
async function scrapeLiveScience() {
  try {
    const feed = await parser.parseURL('https://www.livescience.com/feeds/all');

    const articles = await Promise.all(
      feed.items.slice(0, 12).map(async item => ({
        source: 'Live Science',
        title: item.title,
        link: item.link,
        thumbnail:
          item.enclosure?.url ||
          item['media:thumbnail']?.url ||
          await fetchOGImage(item.link)
      }))
    );

    console.log('📰 Live Science:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ Live Science error:', err.message);
    return [];
  }
}

// ================================
// NATURAL NEWS (RSS)
// ================================
async function scrapeNaturalNews() {
  try {
    const feed = await parser.parseURL('https://www.naturalnews.com/rss.xml');

    const articles = feed.items.slice(0, 15).map(item => ({
      source: 'Natural News',
      title: item.title,
      link: item.link,
      thumbnail:
        item.enclosure?.url ||
        item['media:thumbnail']?.url ||
        placeholder
    }));

    console.log('📰 Natural News:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ Natural News RSS error:', err.message);
    return [];
  }
}

/// ================================
// DAVID ICKE (Latest News page scrape)
// ================================
async function scrapeDavidIcke() {
  try {
    const baseUrl = 'https://davidicke.com';
    const pageUrl = 'https://davidicke.com/category/latest-news/';

    const { data } = await axios.get(pageUrl, {
  timeout: 7000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.google.com/',
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1'
  }
});
    const $ = cheerio.load(data);
    const seen = new Set();
    const articles = [];

    // Current page structure: article titles are linked inside h2 elements
    $('h2 a').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim();

      if (!href || !title) return;

      const link = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      if (seen.has(link)) return;
      seen.add(link);

      let thumbnail =
        $(el).closest('article, div, section').find('img').first().attr('src') ||
        $(el).parent().prevAll('img').first().attr('src') ||
        placeholder;

      if (thumbnail && thumbnail.startsWith('//')) {
        thumbnail = 'https:' + thumbnail;
      } else if (thumbnail && thumbnail.startsWith('/')) {
        thumbnail = new URL(thumbnail, baseUrl).href;
      }

      articles.push({
        source: 'David Icke',
        title,
        link,
        thumbnail
      });
    });

    console.log('📰 David Icke:', articles.length);
    return articles.slice(0, 20);
  } catch (err) {
    console.error('❌ David Icke error:', err.message);
    return [];
  }
}



// ================================
// API Route
// ================================
app.get('/api/scrape', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      scrapeNaturalNews(),
      scrapeMediumConspiracy(),
      scrapeMediumParanormal(),
      scrapeLiveScience(),
      scrapeDavidIcke(),

    ]);

    const articles = results
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);

    res.json(articles);
  } catch (err) {
    console.error('❌ API scrape error:', err.message);
    res.status(500).json({ error: 'Scraping failed.' });
  }
});

// ================================
// Start server
// ================================
app.listen(port, () => {
  console.log(`🧠 Scraper running → http://localhost:${port}`);
});