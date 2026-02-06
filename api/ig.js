/***
  @ Instagram Downloader - Custom Metadata
  @ Author: Shannz (Modified)
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

        // Parse DASH manifest for audio extraction
        let audioTracks = [];
        const dashXml = item.video_dash_manifest;
        
        if (dashXml) {
            try {
                const parser = new XMLParser({ ignoreAttributes: false });
                const manifest = parser.parse(dashXml);
                const period = manifest.MPD?.Period;

                if (period) {
                    const adaptationSets = Array.isArray(period.AdaptationSet) ? period.AdaptationSet : [period.AdaptationSet];

                    adaptationSets.forEach((set) => {
                        if (!set) return;

                        const isAudio = set['@_contentType'] === 'audio';
                        const representations = Array.isArray(set.Representation) ? set.Representation : [set.Representation];

                        representations.forEach((rep) => {
                            if (!rep) return;

                            if (isAudio) {
                                audioTracks.push({
                                    url: rep.BaseURL,
                                    bandwidth: parseInt(rep['@_bandwidth']) || 0,
                                    codecs: rep['@_codecs'] || '',
                                    mimeType: rep['@_mimeType'] || '',
                                    audioSampleRate: rep['@_audioSamplingRate'] || '',
                                    id: rep['@_id'] || ''
                                });
                            }
                        });
                    });
                }
            } catch (xmlError) {
                console.error('DASH parsing error:', xmlError.message);
            }
        }

        // Build custom result
        const finalResult = {
            metadata: {
                id: item.id,
                code: item.code,
                caption: item.caption?.text || '',
                createTime: new Date(item.taken_at * 1000).toLocaleString(),
                takenAt: item.taken_at,
                mediaType: item.media_type,
                productType: item.product_type,
                likeCount: item.like_count,
                commentCount: item.comment_count,
                viewCount: item.view_count,
                hasAudio: item.has_audio,
                organicTrackingToken: item.organic_tracking_token,
            },
            author: {
                id: item.user?.pk,
                username: item.user?.username || 'N/A',
                fullName: item.user?.full_name || '',
                profilePic: item.user?.hd_profile_pic_url_info?.url || item.user?.profile_pic_url || '',
                verified: item.user?.is_verified,
                isPrivate: item.user?.is_private,
                accountBadges: item.user?.account_badges || [],
                categoryName: item.user?.category_name || '',
            },
            rawItem: {
                code: item.code,
                pk: item.pk,
                id: item.id,
                ad_id: item.ad_id,
                taken_at: item.taken_at,
                inventory_source: item.inventory_source,
                video_versions: item.video_versions || [],
            },
            audios: audioTracks,
            originalWidth: item.original_width,
            originalHeight: item.original_height,
            musicInfo: item.clips_metadata?.music_info ? {
                title: item.clips_metadata.music_info.music_asset_info?.title,
                displayArtist: item.clips_metadata.music_info.music_asset_info?.display_artist,
            } : null,
            location: item.location ? {
                name: item.location.name,
                address: item.location.address,
                city: item.location.city,
                lat: item.location.lat,
                lng: item.location.lng,
            } : null,
            accessibility: {
                caption: item.accessibility_caption || ''
            },
            is_paid_partnership: item.is_paid_partnership || false,
            sponsor_tags: item.sponsor_tags || null,
        };

        return {
            status: true,
            result: finalResult
        };

    } catch (error) {
        console.error('Error Main Process:', error.message);
        return { status: false, error: error.message };
    }
}

// Vercel Serverless Handler
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

    // Only allow POST
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
              
