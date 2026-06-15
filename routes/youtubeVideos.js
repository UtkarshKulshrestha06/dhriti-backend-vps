const express = require("express");
const { randomUUID } = require("crypto");
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache } = require("../services/cache");

const router = express.Router();

const CACHE_KEY = "youtube_videos:list";

function extractYouTubeVideoId(input) {
    if (!input || typeof input !== "string") {
        return null;
    }

    const value = input.trim();
    const patterns = [
        /[?&]v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : null;
}

function normalizeYouTubeUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

function formatDurationFromSeconds(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return "";
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function fetchYouTubeMetadata(videoId) {
    const youtubeUrl = normalizeYouTubeUrl(videoId);
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;

    const [oembedResponse, watchResponse] = await Promise.all([
        fetch(oembedUrl),
        fetch(watchUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        })
    ]);

    if (!oembedResponse.ok) {
        throw new Error(`Unable to fetch YouTube metadata for video ${videoId}`);
    }

    const oembedData = await oembedResponse.json();

    if (!watchResponse.ok) {
        throw new Error(`Unable to fetch YouTube watch page for video ${videoId}`);
    }

    const watchHtml = await watchResponse.text();
    const lengthSecondsMatch = watchHtml.match(/"lengthSeconds":"(\d+)"/);
    const approxDurationMatch = watchHtml.match(/"approxDurationMs":"(\d+)"/);

    let totalSeconds = 0;

    if (lengthSecondsMatch?.[1]) {
        totalSeconds = Number(lengthSecondsMatch[1]);
    } else if (approxDurationMatch?.[1]) {
        totalSeconds = Math.round(Number(approxDurationMatch[1]) / 1000);
    }

    return {
        videoId,
        youtubeUrl,
        youtubeTitle: oembedData.title || "",
        channelName: oembedData.author_name || "Dhriti Classes",
        thumbnailUrl: oembedData.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration: formatDurationFromSeconds(totalSeconds)
    };
}

function mapYoutubeVideo(row) {
    return {
        id: row.id,
        videoId: row.video_id,
        youtubeUrl: row.youtube_url,
        customTitle: row.custom_title || "",
        youtubeTitle: row.youtube_title,
        title: row.custom_title || row.youtube_title,
        thumbnail: row.thumbnail_url,
        channelName: row.channel_name || "Dhriti Classes",
        duration: row.duration || "",
        sortOrder: row.sort_order
    };
}

router.get("/", async (req, res) => {
    const cached = cache.get(CACHE_KEY);
    if (cached) {
        return res.json(cached);
    }

    try {
        const videos = await prisma.youtubeVideos.findMany({
            where: { is_active: true },
            orderBy: [
                { sort_order: "asc" },
                { created_at: "asc" }
            ]
        });

        const payload = videos.map(mapYoutubeVideo);
        cache.set(CACHE_KEY, payload, 10 * 60 * 1000);
        res.json(payload);
    } catch (err) {
        console.error("GET YOUTUBE VIDEOS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch YouTube videos" });
    }
});

router.put("/", requireAuth, requireAdmin, async (req, res) => {
    const inputVideos = Array.isArray(req.body?.videos) ? req.body.videos : null;

    if (!inputVideos) {
        return res.status(400).json({ error: "videos array is required" });
    }

    try {
        const preparedVideos = await Promise.all(
            inputVideos.map(async (video, index) => {
                const videoId = extractYouTubeVideoId(video?.youtubeUrl);

                if (!videoId) {
                    throw new Error(`Invalid YouTube URL at item ${index + 1}`);
                }

                const metadata = await fetchYouTubeMetadata(videoId);
                const customTitle = typeof video?.title === "string" ? video.title.trim() : "";

                return {
                    id: typeof video?.id === "string" && video.id.trim() ? video.id.trim() : randomUUID(),
                    youtube_url: metadata.youtubeUrl,
                    video_id: metadata.videoId,
                    custom_title: customTitle || null,
                    youtube_title: metadata.youtubeTitle,
                    thumbnail_url: metadata.thumbnailUrl,
                    channel_name: metadata.channelName,
                    duration: metadata.duration,
                    sort_order: index,
                    is_active: true,
                    updated_at: new Date()
                };
            })
        );

        const duplicateIds = new Set();
        for (const video of preparedVideos) {
            if (duplicateIds.has(video.video_id)) {
                throw new Error(`Duplicate YouTube video detected: ${video.video_id}`);
            }
            duplicateIds.add(video.video_id);
        }

        await prisma.$transaction([
            prisma.youtubeVideos.deleteMany({}),
            prisma.youtubeVideos.createMany({
                data: preparedVideos
            })
        ]);

        const freshVideos = await prisma.youtubeVideos.findMany({
            where: { is_active: true },
            orderBy: [
                { sort_order: "asc" },
                { created_at: "asc" }
            ]
        });

        const payload = freshVideos.map(mapYoutubeVideo);
        cache.invalidate(CACHE_KEY);
        cache.set(CACHE_KEY, payload, 10 * 60 * 1000);

        res.json(payload);
    } catch (err) {
        console.error("UPDATE YOUTUBE VIDEOS ERROR:", err);
        res.status(400).json({ error: err.message || "Failed to update YouTube videos" });
    }
});

module.exports = router;
