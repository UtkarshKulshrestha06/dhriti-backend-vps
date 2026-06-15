const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");

const { uploadFile } = require("../services/ftpService");


// Multer Memory Storage
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage
    // No file size limit
});

const BASE_URL = process.env.HOSTINGER_PUBLIC_URL || "https://dhriticlasses.com/uploads";
const FTP_BASE_PATH = process.env.FTP_BASE_PATH || "public_html/uploads";

/**
 * GET /site-content/bulk?keys=home_banner,gallery,announcements
 * Public: Get multiple site content keys in ONE DB call
 */
router.get("/bulk", async (req, res) => {
    const { keys } = req.query;

    if (!keys) {
        return res.json({});
    }

    const keyList = keys.split(",").map(k => k.trim()).filter(Boolean);
    const result = {};
    const uncachedKeys = [];

    // Check cache first for each key (values are wrapped as {v: value})
    for (const key of keyList) {
        const cached = cache.get(`site_content:${key}`);
        if (cached !== null) {
            result[key] = cached.v; // unwrap
        } else {
            uncachedKeys.push(key);
        }
    }

    // Fetch uncached keys in ONE query
    if (uncachedKeys.length > 0) {
        try {
            const data = await prisma.siteContent.findMany({
                where: {
                    key: { in: uncachedKeys }
                },
                select: {
                    key: true,
                    value: true
                }
            });

            const dataMap = {};
            data.forEach(row => {
                dataMap[row.key] = row.value;
                result[row.key] = row.value;
                cache.set(`site_content:${row.key}`, { v: row.value }, CACHE_TTL.SITE_CONTENT);
            });

            // Set null for keys not found in DB
            for (const key of uncachedKeys) {
                if (!(key in dataMap)) {
                    result[key] = null;
                    cache.set(`site_content:${key}`, { v: null }, CACHE_TTL.SITE_CONTENT);
                }
            }
        } catch (err) {
            console.error("BULK SITE CONTENT ERROR:", err.message);
            // Return whatever we have from cache
        }
    }

    res.json(result);
});

/**
 * GET /site-content/:key
 * Public: Get site content by key (home_banner, gallery, announcements, etc.)
 * CACHED for 10 minutes
 */
router.get("/:key", async (req, res) => {
    const { key } = req.params;

    // Check cache — wrapped as {v: value} so we can cache null values
    const cacheKey = `site_content:${key}`;
    const cached = cache.get(cacheKey);

    if (cached !== null) {
        return res.json(cached.v);
    }

    try {
        const item = await prisma.siteContent.findUnique({
            where: { key: key },
            select: { value: true }
        });

        const value = item ? item.value : null;

        cache.set(cacheKey, { v: value }, CACHE_TTL.SITE_CONTENT);
        res.json(value);
    } catch (err) {
        console.error("GET SITE CONTENT ERROR:", err.message);
        cache.set(cacheKey, { v: null }, CACHE_TTL.SITE_CONTENT);
        res.json(null);
    }
});

/**
 * PUT /site-content/:key
 * Admin: Update site content — invalidates cache
 */
router.put("/:key", requireAuth, requireAdmin, async (req, res) => {
    const { key } = req.params;
    const { content } = req.body;

    try {
        const data = await prisma.siteContent.upsert({
            where: { key: key },
            update: {
                value: content,
                updated_at: new Date()
            },
            create: {
                key: key,
                value: content,
                updated_at: new Date()
            }
        });

        // Invalidate cache for this key
        cache.invalidate(`site_content:${key}`);

        res.json({ success: true, data: data.value });
    } catch (err) {
        console.error("UPDATE SITE CONTENT ERROR:", err);
        res.status(500).json({ error: "Failed to update site content" });
    }
});

/**
 * POST /site-content/upload
 * Admin: Upload image for site content (banners, gallery, etc.)
 */
router.post("/upload", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
    try {
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No file provided" });
        }

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const fileName = `site-${uniqueSuffix}${ext}`;
        const remotePath = `${FTP_BASE_PATH}/site-content/${fileName}`;
        const publicUrl = `${BASE_URL}/site-content/${fileName}`;

        console.log(`Uploading to FTP: ${remotePath}`);
        await uploadFile(file.buffer, remotePath);

        res.json({ url: publicUrl });
    } catch (err) {
        console.error("UPLOAD SITE CONTENT ERROR:", err);
        res.status(500).json({ error: "Upload failed" });
    }
});

module.exports = router;
