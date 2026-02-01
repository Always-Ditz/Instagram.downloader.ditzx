/***
  @ Instagram Downloader API - Vercel Serverless Function
  @ Author: Shannz
***/

import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';

async function instagram(url) {
    if (!url) return { status: false, error: 'URL tidak valid atau kosong.' };

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'cache-control': 'max-age=0',
                'dpr': '2',
                'viewport-width': '980',
                'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-ch-ua-platform-version': '"15.0.0"',
                'sec-ch-ua-model': '"25028RN03A"',
                'sec-ch-ua-full-version-list': '"Chromium";v="136.0.7103.125", "Google Chrome";v="136.0.7103.125", "Not.A/Brand";v="99.0.0.0"',
                'sec-ch-prefers-color-scheme': 'light',
                'dnt': '1',
                'upgrade-insecure-requests': '1',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-user': '?1',
                'sec-fetch-dest': 'document',
                'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'priority': 'u=0, i'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        let scriptJson = null;

        $('script[type="application/json"]').each((_, el) => {
            const content = $(el).html();
            if (content && content.includes('xdt_api__v1__media__shortcode__web_info')) {
                try {
                    scriptJson = JSON.parse(content);
                } catch (parseError) {
                    console.error('JSON Parse Error:', parseError.message);
                }
            }
        });

        if (!scriptJson) throw new Error('Data script tidak ditemukan (Mungkin IP Blocked).');

        const item = scriptJson.require?.[0]?.[3]?.[0]?.__bbox?.require?.[0]?.[3]?.[1]?.__bbox?.result?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0];

        if (!item) throw new Error('Struct item tidak ditemukan dalam JSON.');

        // Determine media type
        const mediaType = item.media_type; // 1 = Image, 2 = Video, 8 = Carousel
        const isCarousel = item.carousel_media || mediaType === 8;
        
        let resultData = {
            type: '',
            url: '',
            thumbnail: '',
            thumbnails: [],
            videoVersions: [],
            dashVideos: [],
            items: [],
            videoDuration: 0,
            musicInfo: null,
            metadata: {
                id: item.id,
                code: item.code,
                username: item.user?.username || 'N/A',
                fullName: item.user?.full_name || '',
                userId: item.user?.pk || '',
                verified: item.user?.is_verified || false,
                profilePic: item.user?.profile_pic_url || '',
                profilePicHD: item.user?.hd_profile_pic_url_info?.url || '',
                title: item.caption?.text || '',
                like_count: item.like_count || 0,
                comment_count: item.comment_count || 0,
                view_count: item.view_count || 0,
                play_count: item.play_count || 0,
                taken_at: item.taken_at || 0,
                mediaType: item.media_type,
                productType: item.product_type || '',
                hasAudio: item.has_audio || false,
                comments: []
            }
        };

        // Get detailed comments with user info
        if (item.preview_comments) {
            resultData.metadata.comments = item.preview_comments.slice(0, 5).map(comment => ({
                id: comment.pk,
                username: comment.user.username,
                userId: comment.user.pk,
                text: comment.text,
                verified: comment.user.is_verified,
                hasLiked: comment.has_liked_comment
            }));
        }

        // Process Carousel (multiple images/videos)
        if (isCarousel && item.carousel_media) {
            resultData.type = 'carousel';
            
            for (const carouselItem of item.carousel_media) {
                if (carouselItem.media_type === 1) {
                    // Image in carousel
                    const imageHD = carouselItem.image_versions2?.candidates?.[0];
                    resultData.items.push({
                        type: 'image',
                        url: imageHD?.url || '',
                        width: imageHD?.width || 0,
                        height: imageHD?.height || 0
                    });
                } else if (carouselItem.media_type === 2) {
                    // Video in carousel
                    const videoVersions = carouselItem.video_versions || [];
                    const videoHD = videoVersions.sort((a, b) => b.width - a.width)[0];
                    
                    resultData.items.push({
                        type: 'video',
                        url: videoHD?.url || '',
                        width: videoHD?.width || 0,
                        height: videoHD?.height || 0,
                        duration: carouselItem.video_duration || 0
                    });
                }
            }
            
            // Set thumbnail from first item
            if (resultData.items.length > 0) {
                if (resultData.items[0].type === 'image') {
                    resultData.thumbnail = resultData.items[0].url;
                } else {
                    resultData.thumbnail = item.image_versions2?.candidates?.[0]?.url || '';
                }
            }
        }
        // Process Single Image
        else if (mediaType === 1) {
            resultData.type = 'image';
            const imageCandidates = item.image_versions2?.candidates || [];
            const imageHD = imageCandidates.sort((a, b) => b.width - a.width)[0];
            
            resultData.url = imageHD?.url || '';
            resultData.thumbnail = imageHD?.url || '';
        }
        // Process Single Video
        else if (mediaType === 2) {
            resultData.type = 'video';
            
            // Get all thumbnails
            const thumbnails = (item.image_versions2?.candidates || []).map(thumb => ({
                url: thumb.url,
                width: thumb.width,
                height: thumb.height,
                resolution: `${thumb.width}x${thumb.height}`
            }));
            
            resultData.thumbnail = thumbnails[0]?.url || '';
            resultData.thumbnails = thumbnails;
            
            // Get all video versions
            const videoVersions = (item.video_versions || []).map(vid => ({
                url: vid.url,
                width: vid.width,
                height: vid.height,
                type: vid.type,
                resolution: `${vid.width}x${vid.height}`
            }));
            
            resultData.videoVersions = videoVersions;
            
            const dashXml = item.video_dash_manifest;
            
            if (dashXml) {
                // Parse DASH manifest for HD video
                const parser = new XMLParser({ ignoreAttributes: false });
                let manifest;
                try {
                    manifest = parser.parse(dashXml);
                } catch (xmlError) {
                    throw new Error(`Gagal parsing DASH manifest: ${xmlError.message}`);
                }

                const period = manifest.MPD?.Period;
                if (period) {
                    const adaptationSets = Array.isArray(period.AdaptationSet) ? period.AdaptationSet : [period.AdaptationSet];
                    let videoTracks = [];

                    adaptationSets.forEach((set) => {
                        if (!set) return;

                        const isVideo = set['@_contentType'] === 'video';
                        if (!isVideo) return;
                        
                        const representations = Array.isArray(set.Representation) ? set.Representation : [set.Representation];

                        representations.forEach((rep) => {
                            if (!rep) return;

                            videoTracks.push({
                                url: rep.BaseURL,
                                bandwidth: parseInt(rep['@_bandwidth']) || 0,
                                width: rep['@_width'],
                                height: rep['@_height'],
                                qualityLabel: rep['@_FBQualityLabel'] || '',
                                resolution: `${rep['@_width']}x${rep['@_height']}`,
                                codecs: rep['@_codecs'] || '',
                                mimeType: rep['@_mimeType'] || ''
                            });
                        });
                    });

                    videoTracks.sort((a, b) => b.bandwidth - a.bandwidth);
                    resultData.dashVideos = videoTracks;
                    
                    const videoHD = videoTracks[0];
                    if (videoHD) {
                        resultData.url = videoHD.url;
                    }
                }
            }
            
            // Fallback to video_versions if DASH not available or failed
            if (!resultData.url && videoVersions.length > 0) {
                const videoHD = videoVersions.sort((a, b) => b.width - a.width)[0];
                resultData.url = videoHD.url;
            }
            
            // Add music/audio info
            if (item.clips_metadata?.music_info) {
                resultData.musicInfo = {
                    title: item.clips_metadata.music_info.music_asset_info?.title || '',
                    artist: item.clips_metadata.music_info.music_asset_info?.display_artist || '',
                    audioClusterId: item.clips_metadata.music_info.music_asset_info?.audio_cluster_id || '',
                    isExplicit: item.clips_metadata.music_info.music_asset_info?.is_explicit || false
                };
            }
            
            // Add video duration
            if (item.video_duration) {
                resultData.videoDuration = item.video_duration;
            }
        }

        return {
            status: true,
            result: resultData
        };

    } catch (error) {
        return { status: false, error: error.message };
    }
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        // Validate Instagram URL
        const instagramUrlPattern = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+/;
        if (!instagramUrlPattern.test(url)) {
            return res.status(400).json({ error: 'Invalid Instagram URL' });
        }

        const result = await instagram(url);

        if (!result.status) {
            return res.status(400).json({ error: result.error });
        }

        return res.status(200).json(result.result);

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
}
;
            }
            
            // Add music/audio info
            if (item.clips_metadata?.music_info) {
                resultData.musicInfo = {
                    title: item.clips_metadata.music_info.music_asset_info?.title || '',
                    artist: item.clips_metadata.music_info.music_asset_info?.display_artist || '',
                    audioClusterId: item.clips_metadata.music_info.music_asset_info?.audio_cluster_id || '',
                    isExplicit: item.clips_metadata.music_info.music_asset_info?.is_explicit || false
                };
            }
            
            // Add video duration
            if (item.video_duration) {
                resultData.videoDuration = item.video_duration;
            }
        }

        return {
            status: true,
            result: resultData
        };

    } catch (error) {
        return { status: false, error: error.message };
    }
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }

        // Validate Instagram URL
        const instagramUrlPattern = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+/;
        if (!instagramUrlPattern.test(url)) {
            return res.status(400).json({ error: 'Invalid Instagram URL' });
        }

        const result = await instagram(url);

        if (!result.status) {
            return res.status(400).json({ error: result.error });
        }

        return res.status(200).json(result.result);

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
                      }
                      
