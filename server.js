const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const parser = new Parser({ timeout: 7000 });
const FEED_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const sourceArticleCache = new Map();
let feedCache = {
  articles: [],
  health: [],
  updatedAt: null
};
let refreshPromise = null;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

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
    key: 'live-science',
    source: 'Live Science',
    type: 'rss',
    url: 'https://www.livescience.com/feeds/all',
    limit: 12
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
    baseUrl: 'https://www.earthfiles.com'
  },
  {
    key: 'unexplained-mysteries',
    source: 'Unexplained Mysteries',
    type: 'rss',
    url: 'https://www.unexplained-mysteries.com/news/umnews.xml',
    limit: 10,
    baseUrl: 'https://www.unexplained-mysteries.com'
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
    thumbnail: thumbnail || null,
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

    if (!String(data || '').trim()) {
      throw new Error('Empty RSS response.');
    }

    return await parser.parseString(data);
  } catch (err) {
    console.warn(`⚠️ RSS parser fallback for ${url}: ${err.message}`);
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

function isFeedCacheStale() {
  if (!feedCache.updatedAt) return true;
  return Date.now() - Date.parse(feedCache.updatedAt) >= FEED_REFRESH_INTERVAL_MS;
}

async function refreshFeedCache() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const sourceResults = await Promise.all(SOURCE_CONFIGS.map(runSource));
    const effectiveResults = sourceResults.map(result => {
      if (result.ok) {
        sourceArticleCache.set(result.key, result.articles);
        return { ...result, stale: false };
      }

      const cachedArticles = sourceArticleCache.get(result.key) || [];

      return {
        ...result,
        articles: cachedArticles,
        stale: cachedArticles.length > 0
      };
    });

    const articles = sortArticlesByDate(
      dedupeArticles(effectiveResults.flatMap(result => result.articles))
    );

    const health = effectiveResults.map(result => ({
      source: result.source,
      ok: result.ok,
      stale: result.stale,
      count: result.articles.length
    }));

    feedCache = {
      articles,
      health,
      updatedAt: new Date().toISOString()
    };

    console.log(`⚡ Feed cache refreshed: ${articles.length} articles`);
    return feedCache;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function triggerFeedRefresh() {
  refreshFeedCache().catch(err => {
    console.error('❌ Feed refresh error:', err.message);
  });
}

app.get('/api/scrape', (req, res) => {
  if (req.query.refresh === '1' || isFeedCacheStale()) {
    triggerFeedRefresh();
  }

  res.set('Cache-Control', 'no-store');
  res.set('X-Feed-Health', JSON.stringify(feedCache.health));
  res.set('X-Feed-Refreshing', String(Boolean(refreshPromise)));
  if (feedCache.updatedAt) {
    res.set('X-Feed-Updated-At', feedCache.updatedAt);
  }
  res.json(feedCache.articles);
});

app.listen(port, () => {
  console.log(`🧠 Scraper running → http://localhost:${port}`);
  triggerFeedRefresh();
  setInterval(triggerFeedRefresh, FEED_REFRESH_INTERVAL_MS).unref();
});
