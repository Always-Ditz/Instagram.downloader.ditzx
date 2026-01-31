// api/ig.js - Vercel Serverless Function
// Using indown.io for download URLs + FastDL for metadata
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE = path.join('/tmp', 'link.chunk.js');
const URL = 'https://fastdl.app/js/link.chunk.js';

// Function to get download URLs from indown.io
async function indown(url) {
  try {
    const get = await axios.get('https://indown.io/en1');

    const kukis = get.headers['set-cookie']
      .map(v => v.split(';')[0])
      .join('; ');

    const t = cheerio.load(get.data)('input[name="_token"]').val();
    
    const dl = await axios.post('https://indown.io/download',
      new URLSearchParams({
        referer: 'https://indown.io/en1',
        locale: 'en',
        _token: t,
        link: url,
        p: 'i'
      }).toString(),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://indown.io',
          referer: 'https://indown.io/en1',
          cookie: kukis,
          'user-agent': 'Mozilla/5.0'
        }
      }
    );

    const $ = cheerio.load(dl.data);
    const urls = $('video source[src], a[href]')
      .map(function(_, e) {
        let v = $(e).attr('src') || $(e).attr('href');
        if (v && v.includes('indown.io/fetch'))
          v = decodeURIComponent(new URL(v).searchParams.get('url'));
        if (!/cdninstagram\.com|fbcdn\.net/.test(v)) return null;
        return v.replace(/&dl=1$/, '');
      })
      .get()
      .filter(function(v, i, a) {
        return v && a.indexOf(v) === i;
      });

    return urls.length ? urls : null;

  } catch (e) {
    throw new Error(e.message);
  }
}

// Function to get metadata from FastDL
async function getMetadata(url) {
  try {
    if (!fs.existsSync(FILE)) {
      let js = await fetch(URL).then(r => r.text());
      js = js.replace(
        /WjkfYp\[0x10\]\)\(k9vssNM\(0x1e2\),/g,
        "WjkfYp[0x10])('https://fastdl.app'+k9vssNM(0x1e2),"
      ).replace(
        "throw new(ilxnw1X(k9vssNM(WjkfYp[0x23])+WjkfYp[0x15]))(k9vssNM(0x1d9)+k9vssNM(0x1da)+k9vssNM(0x1db)+k9vssNM(0x1dc))",
        ""
      );
      fs.writeFileSync(FILE, js);
    }

    global.webpackChunk = [];
    global.self = global;

    await import(FILE + '?v=' + Date.now());

    if (!global.webpackChunk[0]) {
      throw new Error('FastDL chunk not loaded');
    }

    let cache = {};
    let modules = global.webpackChunk[0][1];

    function o(id) {
      if (cache[id]) return cache[id].exports;
      let m = cache[id] = { exports: {} };
      modules[id](m, m.exports, o);
      return m.exports;
    }

    o.r = e => Object.defineProperty(e, "__esModule", { value: true });

    o.d = (e, d) => {
      for (const k in d) {
        if (!Object.prototype.hasOwnProperty.call(e, k)) {
          Object.defineProperty(e, k, { enumerable: true, get: d[k] });
        }
      }
    };

    const mod = o(7027);
    const fn = await mod.default;
    const signed = await fn(url);

    const res = await fetch("https://api-wh.fastdl.app/api/convert", {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://fastdl.app/',
        'Origin': 'https://fastdl.app'
      },
      body: new URLSearchParams(signed)
    });

    const json = await res.json();

    let metadata = null;
    let thumbnail = null;

    // Extract metadata if available
    if (json.meta) {
      metadata = {
        title: json.meta.title || '',
        username: json.meta.username || '',
        source: json.meta.source || '',
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
    console.error('Metadata fetch error:', e.message);
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
    const links = await indown(url);

    if (!links || links.length === 0) {
      return res.status(500).json({ 
        error: 'Could not fetch Instagram content',
        details: 'No media found. The post might be private or unavailable.'
      });
    }

    // Get metadata from FastDL (non-blocking, if fails just continue)
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
  
