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
// Wired
// ================================
async function scrapeWired() {
  try {
    const baseUrl = 'https://www.wired.com';
    const { data } = await axios.get(baseUrl, { timeout: 5000 });
    const $ = cheerio.load(data);

    const articles = [];

    $('a.summary-item__hed-link').each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr('href');
      if (!title || !href) return;

      const link = href.startsWith('http') ? href : `${baseUrl}${href}`;
      const img = $(el).closest('.summary-item').find('img').attr('src');

      articles.push({
        source: 'Wired',
        title,
        link,
        thumbnail: img || placeholder
      });
    });

    console.log('📰 Wired:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ Wired error:', err.message);
    return [];
  }
}

// ================================
// BBC
// ================================
async function scrapeBBC() {
  try {
    const feed = await parser.parseURL('https://feeds.bbci.co.uk/news/rss.xml');

    const articles = await Promise.all(
      feed.items.slice(0, 15).map(async item => ({
        source: 'BBC',
        title: item.title,
        link: item.link,
        thumbnail:
          item.enclosure?.url ||
          item['media:thumbnail']?.url ||
          await fetchOGImage(item.link)
      }))
    );

    console.log('📰 BBC:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ BBC error:', err.message);
    return [];
  }
}

// ================================
// CNET
// ================================
async function scrapeCNET() {
  try {
    const feed = await parser.parseURL('https://www.cnet.com/rss/news/');

    const articles = await Promise.all(
      feed.items.slice(0, 15).map(async item => ({
        source: 'CNET',
        title: item.title,
        link: item.link,
        thumbnail:
          item.enclosure?.url ||
          item['media:thumbnail']?.url ||
          await fetchOGImage(item.link)
      }))
    );

    console.log('📰 CNET:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ CNET error:', err.message);
    return [];
  }
}

// ================================
// Reuters (lightweight API version)
// ================================
async function scrapeReuters() {
  const API_KEY = 'pub_60c0bd2f19914b6485ed5fa4161a4503';
  const url = `https://newsdata.io/api/1/news?apikey=${API_KEY}&q=reuters&language=en`;

  try {
    const { data } = await axios.get(url, { timeout: 5000 });

    console.log('🧪 Reuters raw results:', data?.results?.length || 0);

    if (!data.results || data.results.length === 0) {
      console.warn('⚠️ Reuters returned ZERO articles');
      return [];
    }

    const articles = data.results.slice(0, 10).map(article => ({
      source: 'Reuters',
      title: article.title,
      link: article.link || '#',
      thumbnail:
        article.image_url && article.image_url.startsWith('http')
          ? article.image_url
          : placeholder
    }));

    console.log('📰 Reuters:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ Reuters API error:', err.response?.data || err.message);
    return [];
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
// API Route
// ================================
app.get('/api/scrape', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      scrapeWired(),
      scrapeBBC(),
      scrapeCNET(),
      scrapeReuters(),
      scrapeRedditUFO(),

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