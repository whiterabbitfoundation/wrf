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

const DEFAULT_HEADERS = {
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
};

const SOURCE_CONFIGS = [
  {
    key: 'natural-news',
    source: 'Natural News',
    type: 'rss',
    url: 'https://www.naturalnews.com/rss.xml',
    limit: 15
  },
  {
    key: 'medium-conspiracy',
    source: 'Medium Conspiracy',
    type: 'rss',
    url: 'https://medium.com/feed/tag/conspiracy',
    limit: 10
  },
  {
    key: 'medium-paranormal',
    source: 'Medium Paranormal',
    type: 'rss',
    url: 'https://medium.com/feed/tag/paranormal',
    limit: 10
  },
  {
    key: 'live-science',
    source: 'Live Science',
    type: 'rss',
    url: 'https://www.livescience.com/feeds/all',
    limit: 12,
    mapItem: async item => ({
      thumbnail:
        getItemThumbnail(item) ||
        await fetchOGImage(item.link)
    })
  },
  {
    key: 'black-vault',
    source: 'Black Vault',
    type: 'rss',
    url: 'https://www.theblackvault.com/documentarchive/feed/',
    limit: 10
  },
  {
    key: 'ancient-origins',
    source: 'Ancient Origins',
    type: 'rss',
    url: 'https://feeds.feedburner.com/AncientOrigins',
    limit: 12
  },
  {
    key: 'earthfiles',
    source: 'Earthfiles',
    type: 'rss',
    url: 'https://www.earthfiles.com/feed/',
    limit: 10,
    mapItem: async item => ({
      thumbnail:
        getItemThumbnail(item, 'https://www.earthfiles.com') ||
        await fetchOGImage(item.link)
    })
  },
  {
    key: 'unexplained-mysteries',
    source: 'Unexplained Mysteries',
    type: 'rss',
    url: 'https://www.unexplained-mysteries.com/news/umnews.xml',
    limit: 10,
    mapItem: async item => ({
      thumbnail:
        getItemThumbnail(item, 'https://www.unexplained-mysteries.com') ||
        await fetchOGImage(item.link)
    })
  },
  {
    key: 'david-icke',
    source: 'David Icke',
    type: 'html',
    url: 'https://davidicke.com/category/latest-news/',
    baseUrl: 'https://davidicke.com',
    limit: 20,
    extractItems: extractDavidIckeArticles
  }
];

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function toAbsoluteUrl(url, baseUrl) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (!baseUrl) return null;

  try {
    return new URL(url, baseUrl).href;
  } catch (err) {
    return null;
  }
}

function getItemThumbnail(item, baseUrl) {
  return (
    toAbsoluteUrl(item.enclosure?.url, baseUrl) ||
    toAbsoluteUrl(item['media:thumbnail']?.url, baseUrl) ||
    toAbsoluteUrl(item.thumbnail, baseUrl) ||
    null
  );
}

function getPublishedAt(item) {
  return item.isoDate || item.pubDate || item.published || null;
}

function normalizeArticle({
  source,
  title,
  link,
  thumbnail,
  publishedAt
}) {
  if (!title || !link) return null;

  return {
    source,
    title: String(title).trim(),
    link,
    thumbnail: thumbnail || placeholder,
    publishedAt: publishedAt || null
  };
}

async function fetchHtml(url, timeout = 7000) {
  const { data } = await axios.get(url, {
    timeout,
    headers: DEFAULT_HEADERS
  });

  return data;
}

async function fetchOGImage(url) {
  try {
    const data = await fetchHtml(url, 4000);
    const $ = cheerio.load(data);

    const candidates = [
      $('meta[property="og:image"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content'),
      $('article img').first().attr('src'),
      $('img').first().attr('src')
    ];

    const img = candidates.find(Boolean);
    return toAbsoluteUrl(img, url) || placeholder;
  } catch (err) {
    console.warn(`⚠️ Failed image fetch for ${url}: ${err.message}`);
    return placeholder;
  }
}

async function fetchRssFeed(url, timeout = 7000) {
  try {
    const { data } = await axios.get(url, {
      timeout,
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      },
      responseType: 'text'
    });

    return await parser.parseString(data);
  } catch (err) {
    return parser.parseURL(url);
  }
}

async function scrapeRssSource(config) {
  const feed = await fetchRssFeed(config.url);
  const items = feed.items.slice(0, config.limit);

  const articles = await Promise.all(
    items.map(async item => {
      const extra = config.mapItem ? await config.mapItem(item) : {};

      return normalizeArticle({
        source: config.source,
        title: item.title,
        link: item.link,
        thumbnail: extra.thumbnail || getItemThumbnail(item, config.baseUrl),
        publishedAt: extra.publishedAt || getPublishedAt(item)
      });
    })
  );

  return articles.filter(Boolean);
}

function extractDavidIckeArticles($, config) {
  const seen = new Set();
  const articles = [];

  $('h2 a, h3 a, article a').each((_, el) => {
    const href = $(el).attr('href');
    const title = $(el).text().trim();
    const link = toAbsoluteUrl(href, config.baseUrl);

    if (!link || !title || title.length < 15) return;
    if (!link.includes('davidicke.com')) return;
    if (seen.has(link)) return;

    seen.add(link);

    const nearbyImage =
      $(el).closest('article, div, section').find('img').first().attr('src');

    articles.push(
      normalizeArticle({
        source: config.source,
        title,
        link,
        thumbnail: toAbsoluteUrl(nearbyImage, config.baseUrl),
        publishedAt: null
      })
    );
  });

  return articles.filter(Boolean).slice(0, config.limit);
}

async function scrapeHtmlSource(config) {
  const data = await fetchHtml(config.url);
  const $ = cheerio.load(data);
  return config.extractItems($, config);
}

async function runSource(config) {
  try {
    const articles =
      config.type === 'html'
        ? await scrapeHtmlSource(config)
        : await scrapeRssSource(config);

    console.log(`📰 ${config.source}: ${articles.length}`);

    return {
      key: config.key,
      source: config.source,
      ok: true,
      articles
    };
  } catch (err) {
    console.error(`❌ ${config.source} error:`, err.response?.status || err.message);

    return {
      key: config.key,
      source: config.source,
      ok: false,
      articles: [],
      error: err.message
    };
  }
}

function dedupeArticles(articles) {
  const seen = new Set();

  return articles.filter(article => {
    const key = article.link;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSortableTimestamp(article) {
  const value = article.publishedAt ? Date.parse(article.publishedAt) : NaN;
  return Number.isNaN(value) ? 0 : value;
}

function sortArticlesByDate(articles) {
  return [...articles].sort(
    (a, b) => getSortableTimestamp(b) - getSortableTimestamp(a)
  );
}

app.get('/api/scrape', async (req, res) => {
  try {
    const sourceResults = await Promise.all(SOURCE_CONFIGS.map(runSource));

    const articles = sortArticlesByDate(
      dedupeArticles(sourceResults.flatMap(result => result.articles))
    );

    const health = sourceResults.map(result => ({
      source: result.source,
      ok: result.ok,
      count: result.articles.length
    }));

    res.set('X-Feed-Health', JSON.stringify(health));
    res.json(articles);
  } catch (err) {
    console.error('❌ API scrape error:', err.message);
    res.status(500).json({ error: 'Scraping failed.' });
  }
});

app.listen(port, () => {
  console.log(`🧠 Scraper running → http://localhost:${port}`);
});
