// api/download.js - Vercel Serverless Function with Streaming Download

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

  try {
    const { url, type } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Media URL is required' });
    }

    const decodedUrl = decodeURIComponent(url);

    // Fetch the media file with streaming
    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to fetch media',
        details: `HTTP ${response.status}: ${response.statusText}`
      });
    }

    // Determine file extension and content type
    let extension = 'jpg';
    let contentType = response.headers.get('content-type') || 'image/jpeg';
    
    if (type === 'video' || contentType.includes('video')) {
      extension = 'mp4';
      contentType = 'video/mp4';
    } else if (type === 'image' || contentType.includes('image')) {
      // Detect image format from content-type
      if (contentType.includes('png')) {
        extension = 'png';
        contentType = 'image/png';
      } else if (contentType.includes('gif')) {
        extension = 'gif';
        contentType = 'image/gif';
      } else if (contentType.includes('webp')) {
        extension = 'webp';
        contentType = 'image/webp';
      } else {
        extension = 'jpg';
        contentType = 'image/jpeg';
      }
    }

    // Generate filename with timestamp
    const timestamp = Date.now();
    const filename = `instagram_${timestamp}.${extension}`;

    // Set response headers for download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    
    // Get content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Stream the response
    if (response.body) {
      const reader = response.body.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          // Write chunk to response
          res.write(Buffer.from(value));
        }
        
        res.end();
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Streaming failed',
            message: streamError.message 
          });
        } else {
          res.end();
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      // Fallback: buffer entire response
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }

  } catch (error) {
    console.error('Error in download.js:', error);
    
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  }
    }
        
