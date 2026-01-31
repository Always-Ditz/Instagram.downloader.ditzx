// api/ig.js - Instagram Downloader API
// Using indown.io for download URLs + Instagram scraping for metadata
import axios from 'axios';
import * as cheerio from 'cheerio';

// Function to get download URLs from indown.io
async function indown(url) {
  try {
    // Step 1: Get homepage with proper headers
    const get = await axios.get('https://indown.io/en1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      }
    });

    // Extract cookies properly
    const cookies = get.headers['set-cookie'];
    if (!cookies || cookies.length === 0) {
      throw new Error('Failed to get cookies from indown.io');
    }

    const kukis = cookies.map(v => v.split(';')[0]).join('; ');
    
    // Extract CSRF token
    const $ = cheerio.load(get.data);
    const token = $('input[name="_token"]').val();
    
    if (!token) {
      throw new Error('Failed to get CSRF token from indown.io');
    }

    // Step 2: Submit download request
    const dl = await axios.post('https://indown.io/download',
      new URLSearchParams({
        referer: 'https://indown.io/en1',
        locale: 'en',
        _token: token,
        link: url,
        p: 'i'
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://indown.io',
          'Referer': 'https://indown.io/en1',
          'Cookie': kukis,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'X-Requested-With': 'XMLHttpRequest',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin'
        },
        maxRedirects: 5,
        timeout: 30000
      }
    );

    // Step 3: Parse response and extract URLs
    const $dl = cheerio.load(dl.data);
    const urls = $dl('video source[src], a[href]')
      .map(function(_, e) {
        let v = $dl(e).attr('src') || $dl(e).attr('href');
        if (v && v.includes('indown.io/fetch')) {
          try {
            v = decodeURIComponent(new URL(v).searchParams.get('url'));
          } catch (err) {
            return null;
          }
        }
        if (!v || !/cdninstagram\.com|fbcdn\.net/.test(v)) return null;
        return v.replace(/&dl=1$/, '');
      })
      .get()
      .filter(function(v, i, a) {
        return v && a.indexOf(v) === i;
      });

    return urls.length ? urls : null;

  } catch (e) {
    console.error('indown.io error:', e.message);
    throw new Error(`Failed to fetch from indown.io: ${e.message}`);
  }
}

// Function to get metadata from sssinstagram.com (with full stats & comments)
async function getMetadataFromSSS(url) {
  try {
    // Step 1: Get current timestamp
    const msecRes = await axios.get('https://sssinstagram.com/msec', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const currentMsec = msecRes.data.msec;
    
    // Step 2: Prepare parameters
    const _ts = 1769598002953; // Base timestamp (from sssinstagram)
    const _tsc = 0;
    const ts = Math.floor(currentMsec * 1000);
    
    // Step 3: Generate signature
    const crypto = await import('crypto');
    const signData = `${url}${ts}${_ts}${_tsc}`;
    const _s = crypto.createHash('sha256').update(signData).digest('hex');
    
    // Step 4: Call API
    const params = new URLSearchParams({
      sf_url: url,
      ts: ts.toString(),
      _ts: _ts.toString(),
      _tsc: _tsc.toString(),
      _s: _s
    });

    const res = await axios.post('https://api-wh.sssinstagram.com/api/convert', params.toString(), {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://sssinstagram.com/',
        'Origin': 'https://sssinstagram.com'
      },
      timeout: 15000
    });

    const json = res.data;

    let metadata = null;
    let thumbnail = null;

    // Extract metadata
    if (json.meta) {
      metadata = {
        title: json.meta.title || '',
        username: json.meta.username || '',
        source: json.meta.source || url,
        shortcode: json.meta.shortcode || '',
        like_count: json.meta.like_count || 0,
        comment_count: json.meta.comment_count || 0,
        taken_at: json.meta.taken_at || null,
        comments: json.meta.comments || []
      };
    }

    // Extract thumbnail
    if (json.thumb) {
      thumbnail = json.thumb;
    }

    return { metadata, thumbnail };
    
  } catch (e) {
    console.error('sssinstagram metadata error:', e.message);
    return { metadata: null, thumbnail: null };
  }
}

// Function to get metadata by scraping Instagram (fallback)
async function getMetadata(url) {
  // Try sssinstagram first (has full metadata with comments)
  try {
    const sssResult = await getMetadataFromSSS(url);
    if (sssResult.metadata) {
      console.log('✅ Got metadata from sssinstagram.com');
      return sssResult;
    }
  } catch (sssErr) {
    console.error('sssinstagram failed, falling back to scraping:', sssErr.message);
  }

  // Fallback: Direct Instagram scraping
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });

    const html = response.data;
    const $ = cheerio.load(html);
    
    let metadata = null;
    let thumbnail = null;

    // Try extracting from JSON-LD
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        
        metadata = {
          title: jsonData.caption || jsonData.articleBody || '',
          username: jsonData.author?.alternateName || jsonData.author || '',
          source: url,
          shortcode: url.match(/\/(p|reel|tv)\/([^/?]+)/)?.[2] || '',
          like_count: 0,
          comment_count: 0,
          taken_at: jsonData.uploadDate ? Math.floor(new Date(jsonData.uploadDate).getTime() / 1000) : null,
          comments: []
        };

        thumbnail = jsonData.thumbnailUrl || jsonData.image || null;
        if (Array.isArray(thumbnail)) thumbnail = thumbnail[0];
        
      } catch (parseErr) {
        console.error('Failed to parse JSON-LD:', parseErr.message);
      }
    }

    // Fallback: Extract from meta tags
    if (!metadata) {
      metadata = {
        title: $('meta[property="og:title"]').attr('content') || 
               $('meta[name="description"]').attr('content') || '',
        username: $('meta[property="og:site_name"]').attr('content')?.replace('Instagram', '').trim() || '',
        source: url,
        shortcode: url.match(/\/(p|reel|tv)\/([^/?]+)/)?.[2] || '',
        like_count: 0,
        comment_count: 0,
        taken_at: null,
        comments: []
      };

      thumbnail = $('meta[property="og:image"]').attr('content') || 
                 $('meta[property="og:video:thumbnail"]').attr('content') || null;
    }

    console.log('✅ Got metadata from Instagram scraping');
    return { metadata, thumbnail };
    
  } catch (e) {
    console.error('All metadata methods failed:', e.message);
    return { metadata: null, thumbnail: null };
  }
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Instagram URL is required' });
    }

    // Validate Instagram URL
    const instagramPattern = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[\w-]+/;
    if (!instagramPattern.test(url)) {
      return res.status(400).json({ error: 'Invalid Instagram URL' });
    }

    // Get download links from indown.io
    let links = null;
    let indownError = null;
    
    try {
      links = await indown(url);
    } catch (indownErr) {
      indownError = indownErr.message;
      console.error('indown.io failed:', indownErr.message);
    }

    if (!links || links.length === 0) {
      return res.status(500).json({ 
        error: 'Could not fetch Instagram content',
        details: indownError || 'No media found. The post might be private or unavailable.',
        service: 'indown.io'
      });
    }

    // Get metadata from Instagram (non-blocking)
    let metadata = null;
    let thumbnail = null;
    
    try {
      const metaResult = await getMetadata(url);
      metadata = metaResult.metadata;
      thumbnail = metaResult.thumbnail;
    } catch (metaErr) {
      console.error('Metadata fetch failed:', metaErr.message);
      // Continue without metadata
    }

    // Determine media types by checking URLs
    const mediaItems = [];
    
    for (const mediaUrl of links) {
      // Check if URL contains video indicators
      const isVideo = /\.mp4/.test(mediaUrl) || 
                     mediaUrl.includes('video') ||
                     mediaUrl.includes('/v/');
      
      if (isVideo) {
        mediaItems.push({
          type: 'video',
          url: mediaUrl
        });
      } else {
        mediaItems.push({
          type: 'image',
          url: mediaUrl
        });
      }
    }

    // Prepare response with metadata
    const response = {
      metadata: metadata,
      thumbnail: thumbnail
    };

    // Return appropriate format based on number of items
    if (mediaItems.length === 1) {
      response.type = mediaItems[0].type;
      response.url = mediaItems[0].url;
    } else {
      response.type = 'carousel';
      response.items = mediaItems;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in ig.js:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
      }
        
