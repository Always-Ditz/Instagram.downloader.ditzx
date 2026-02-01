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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': decodedUrl.includes('sssinstagram') ? 'https://sssinstagram.com/' : 'https://www.instagram.com/',
        'Origin': decodedUrl.includes('sssinstagram') ? 'https://sssinstagram.com' : 'https://www.instagram.com',
        'Accept': '*/*'
      },
      redirect: 'follow' // Follow redirects from sssinstagram proxy
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
      // Detect image format from content-type or URL
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
    } else {
      // Auto-detect from first few bytes
      const reader = response.body.getReader();
      const { value: chunk } = await reader.read();
      
      if (chunk) {
        const signature = Buffer.from(chunk).slice(4, 8).toString();
        if (signature === 'ftyp') {
          extension = 'mp4';
          contentType = 'video/mp4';
        }
      }
      
      // Re-fetch since we consumed the stream
      reader.releaseLock();
      const newResponse = await fetch(decodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://www.instagram.com/'
        }
      });
      
      // Use the new response for streaming
      return streamResponse(newResponse, res, contentType, extension);
    }

    return streamResponse(response, res, contentType, extension);

  } catch (error) {
    console.error('Error in download.js:', error);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

async function streamResponse(fetchResponse, res, contentType, extension) {
  // Generate filename
  const timestamp = Date.now();
  const filename = `instagram_${timestamp}.${extension}`;

  // Set response headers for download
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
  
  // Get content length if available
  const contentLength = fetchResponse.headers.get('content-length');
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  // Stream the response chunk by chunk
  const reader = fetchResponse.body.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
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
}
