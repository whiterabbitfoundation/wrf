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
// Reddit
// ================================
async function scrapeRedditUFO() {
  try {
    const feed = await parser.parseURL('https://www.reddit.com/r/UFOs/.rss');

    return feed.items.slice(0, 10).map(item => ({
      source: 'Reddit UFOs',
      title: item.title,
      link: item.link,
      thumbnail: 'https://www.redditstatic.com/icon.png'
    }));
  } catch (err) {
    console.error('Reddit UFO error:', err.message);
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

// ================================
// API Route
// ================================
app.get('/api/scrape', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      scrapeBBC(),
      scrapeCNET(),
      scrapeReuters(),
      scrapeRedditUFO(),
      scrapeNaturalNews(),

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