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

// ================================
// Helper: Follow redirects (e.g., Google News → Reuters)
// ================================
async function resolveFinalURL(url) {
  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 5000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
      }
    });
    return res.request.res.responseUrl || url;
  } catch (err) {
    console.warn(`⚠️ Redirect failed for ${url}: ${err.message}`);
    return url;
  }
}

// ================================
// Helper: Extract og:image
// ================================
async function fetchOGImage(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    const ogImg = $('meta[property="og:image"]').attr('content');
    const fallbackImg = $('article img').first().attr('src');

    return ogImg || fallbackImg || placeholder;
  } catch (err) {
    console.warn(`⚠️ Failed to fetch OG image for ${url}: ${err.message}`);
    return placeholder;
  }
}

// ================================
// Wired Scraper (Web)
// ================================
async function scrapeWired() {
  try {
    const url = 'https://www.wired.com';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const articles = [];

    $('a.summary-item__hed-link').each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr('href');
      const link = href.startsWith('http') ? href : url + href;
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
// BBC Scraper (RSS + og:image fallback)
// ================================
async function scrapeBBC() {
  try {
    const feed = await parser.parseURL('https://feeds.bbci.co.uk/news/rss.xml');

    const articles = await Promise.all(feed.items.map(async item => ({
      source: 'BBC',
      title: item.title,
      link: item.link,
      thumbnail: item.enclosure?.url ||
                 item['media:thumbnail']?.url ||
                 await fetchOGImage(item.link)
    })));

    console.log('📰 BBC:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ BBC error:', err.message);
    return [];
  }
}

// ================================
// CNET Scraper (RSS + og:image fallback)
// ================================
async function scrapeCNET() {
  try {
    const feed = await parser.parseURL('https://www.cnet.com/rss/news/');

    const articles = await Promise.all(feed.items.map(async item => ({
      source: 'CNET',
      title: item.title,
      link: item.link,
      thumbnail: item.enclosure?.url ||
                 item['media:thumbnail']?.url ||
                 await fetchOGImage(item.link)
    })));

    console.log('📰 CNET:', articles.length);
    return articles;
  } catch (err) {
    console.error('❌ CNET error:', err.message);
    return [];
  }
}

// ================================
// Reuters Scraper (NewsData.io API + og:image fallback)
// ================================
async function scrapeReuters() {
  const API_KEY = 'pub_60c0bd2f19914b6485ed5fa4161a4503';

  // ✅ FREE-TIER SAFE QUERY
  const url = `https://newsdata.io/api/1/news?apikey=${API_KEY}&q=reuters&language=en`;

  try {
    const { data } = await axios.get(url);

    console.log('🧪 Reuters raw results:', data.results?.length || 0);

    if (!data.results || data.results.length === 0) {
      console.warn('⚠️ Reuters returned ZERO articles');
      return [];
    }

    const articles = await Promise.all(
      data.results.map(async article => {
        if (!article.link) return null;

        const finalUrl = await resolveFinalURL(article.link);

        let img = article.image_url;
        if (!img || !img.startsWith('http')) {
          img = await fetchOGImage(finalUrl);
        }

        return {
          source: 'Reuters',
          title: article.title,
          link: finalUrl,
          thumbnail: img || PLACEHOLDER
        };
      })
    );

    const clean = articles.filter(Boolean);
    console.log('📰 Reuters:', clean.length);
    return clean;
  } catch (err) {
    console.error(
      '❌ Reuters API error:',
      err.response?.data || err.message
    );
    return [];
  }
}


// ================================
// API Route
// ================================
app.get('/api/scrape', async (_, res) => {
  const results = await Promise.allSettled([
    scrapeWired(),
    scrapeBBC(),
    scrapeCNET(),
    scrapeReuters()
  ]);

  const articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  res.json(articles);
});

// ================================
// Start Server
// ================================
app.listen(port, () => {
  console.log(`🧠 Scraper running → http://localhost:${port}/api/scrape`);
});
