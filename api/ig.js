// api/ig.js - Instagram Downloader API
// Using indown.io for download URLs + Instagram scraping for metadata
import axios from 'axios';
import * as cheerio from 'cheerio';

// Function to get download URLs and metadata from sssinstagram.com
async function fetchFromSSS(url) {
  try {
    // Step 1: Get current timestamp
    const msecRes = await axios.get('https://sssinstagram.com/msec', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    const currentMsec = msecRes.data.msec;
    
    // Step 2: Prepare parameters
    const _ts = 1769598002953; // Base timestamp
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://sssinstagram.com/',
        'Origin': 'https://sssinstagram.com'
      },
      timeout: 15000
    });

    const json = res.data;

    // Extract download URLs
    let urls = [];
    if (json.url && Array.isArray(json.url)) {
      urls = json.url.map(item => item.url).filter(Boolean);
    }

    // Extract metadata
    let metadata = null;
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
    let thumbnail = json.thumb || null;

    return { urls, metadata, thumbnail };
    
  } catch (e) {
    console.error('sssinstagram error:', e.message);
    throw new Error(`Failed to fetch from sssinstagram: ${e.message}`);
  }
}

// Function to get metadata by scraping Instagram (fallback only)
async function getMetadataFallback(url) {
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

    return { metadata, thumbnail };
    
  } catch (e) {
    console.error('Metadata scraping error:', e.message);
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

    // Get download links and metadata from sssinstagram.com
    let urls = null;
    let metadata = null;
    let thumbnail = null;
    let sssError = null;
    
    try {
      const result = await fetchFromSSS(url);
      urls = result.urls;
      metadata = result.metadata;
      thumbnail = result.thumbnail;
      
      console.log(`✅ Got ${urls?.length || 0} URLs from sssinstagram`);
    } catch (sssErr) {
      sssError = sssErr.message;
      console.error('sssinstagram failed:', sssErr.message);
    }

    // If sssinstagram failed, try getting metadata from scraping
    if (!urls || urls.length === 0) {
      if (!metadata) {
        try {
          const fallbackMeta = await getMetadataFallback(url);
          metadata = fallbackMeta.metadata;
          thumbnail = fallbackMeta.thumbnail;
          console.log('✅ Got metadata from fallback scraping');
        } catch (metaErr) {
          console.error('Metadata fallback also failed:', metaErr.message);
        }
      }
      
      return res.status(500).json({ 
        error: 'Could not fetch Instagram content',
        details: sssError || 'No media found. The post might be private or unavailable.',
        service: 'sssinstagram.com'
      });
    }

    // Determine media types by checking URLs
    const mediaItems = [];
    
    for (const mediaUrl of urls) {
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
                      
