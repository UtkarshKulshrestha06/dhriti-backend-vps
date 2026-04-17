const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { uploadFile, deleteFile } = require("../services/ftpService");
const { cache, CACHE_TTL } = require("../services/cache");

const prisma = new PrismaClient();

// Multer Memory Storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const BASE_URL = process.env.HOSTINGER_PUBLIC_URL || "https://dhriticlasses.com/uploads";
const FTP_BASE_PATH = process.env.FTP_BASE_PATH || "public_html/uploads";

/**
 * GET /
 * Public: List all blogs
 */
router.get("/", async (req, res) => {
    const cached = cache.get('blogs:all');
    if (cached) {
        return res.json(cached);
    }

    try {
        const data = await prisma.blogs.findMany({
            orderBy: { published_at: 'desc' }
        });

        cache.set('blogs:all', data, CACHE_TTL.BATCHES);
        res.json(data);
    } catch (err) {
        console.error("Error fetching blogs:", err);
        res.status(500).json({ error: "Failed to fetch blogs" });
    }
});

/**
 * GET /sitemap-blogs.xml
 * Public: Generate XML sitemap for blogs
 */
router.get("/sitemap-blogs.xml", async (req, res) => {
    try {
        const data = await prisma.blogs.findMany({
            select: { slug: true, updated_at: true },
            orderBy: { published_at: 'desc' }
        });

        const baseUrl = "https://dhriticlasses.com/blogs";
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Main blogs index
        xml += `  <url>\n    <loc>${baseUrl}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;

        // Individual posts
        data.forEach(blog => {
            const date = blog.updated_at ? new Date(blog.updated_at).toISOString() : new Date().toISOString();
            xml += `  <url>\n    <loc>${baseUrl}/${blog.slug}</loc>\n    <lastmod>${date}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        });

        xml += '</urlset>';

        res.set('Content-Type', 'text/xml');
        res.send(xml);
    } catch (err) {
        console.error("Error generating sitemap:", err);
        res.status(500).send("Error generating sitemap");
    }
});

/**
 * GET /manage/:id
 * Admin: Get single blog by ID for editing
 * NOTE: This route MUST be defined before /:slug to prevent Express
 * from matching "manage" as a slug parameter.
 */
router.get("/manage/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const data = await prisma.blogs.findUnique({
            where: { id }
        });

        if (!data) throw new Error("Blog not found");
        res.json(data);
    } catch (err) {
        console.error("Error fetching blog by ID:", err);
        res.status(404).json({ error: "Blog not found" });
    }
});

/**
 * GET /:slug
 * Public: Get single blog by slug
 */
router.get("/:slug", async (req, res) => {
    const { slug } = req.params;
    const cacheKey = `blogs:slug:${slug}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const data = await prisma.blogs.findUnique({
            where: { slug }
        });

        if (!data) throw new Error("Blog not found");
        cache.set(cacheKey, data, CACHE_TTL.BATCHES);
        res.json(data);
    } catch (err) {
        console.error("Error fetching blog:", err);
        res.status(404).json({ error: "Blog not found" });
    }
});

/**
 * POST /
 * Admin: Create a new blog
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { title, slug, excerpt, cover_image, category, author_name, author_avatar, read_time, sections, tags } = req.body;

        // Basic validation
        if (!title || !slug || !sections) {
            return res.status(400).json({ error: "Missing required fields: title, slug, or sections" });
        }

        let uniqueSlug = slug;
        // Check slug existence
        const existing = await prisma.blogs.findUnique({
            where: { slug: uniqueSlug },
            select: { id: true }
        });
        
        if (existing) {
            uniqueSlug = `${slug}-${Math.round(Math.random() * 10000)}`;
        }

        const data = await prisma.blogs.create({
            data: {
                title,
                slug: uniqueSlug,
                excerpt,
                cover_image: cover_image || null,
                category,
                author_name,
                author_avatar,
                read_time,
                sections,
                tags
            }
        });

        cache.invalidatePattern('blogs:');
        res.status(201).json(data);
    } catch (err) {
        console.error("Error creating blog:", err);
        res.status(500).json({ error: "Failed to create blog", details: err.message });
    }
});

/**
 * DELETE /:id
 * Admin: Delete a blog
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.blogs.delete({
            where: { id }
        });

        cache.invalidatePattern('blogs:');
        res.json({ message: "Blog deleted successfully" });
    } catch (err) {
        console.error("Error deleting blog:", err);
        res.status(500).json({ error: "Failed to delete blog" });
    }
});

/**
 * POST /upload-image
 * Admin: Upload image for blog content
 */
router.post("/upload-image", requireAuth, requireAdmin, upload.single("image"), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: "No image file provided" });
        }

        // Generate filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const fileName = `blog-${uniqueSuffix}${ext}`;
        const remotePath = `${FTP_BASE_PATH}/blogs/${fileName}`;
        const publicUrl = `${BASE_URL}/blogs/${fileName}`;

        console.log(`Uploading blog image to FTP: ${remotePath}`);
        await uploadFile(file.buffer, remotePath);

        res.json({
            success: true,
            url: publicUrl
        });
    } catch (err) {
        console.error("Error uploading blog image:", err);
        res.status(500).json({ error: "Failed to upload image" });
    }
});

/**
 * PUT /:id
 * Admin: Update a blog
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, slug, excerpt, cover_image, category, read_time, sections, tags, published_at } = req.body;

    // Basic validation
    if (!title || !slug || !sections) {
        return res.status(400).json({ error: "Missing required fields: title, slug, or sections" });
    }

    try {
        const updateData = {
            title,
            slug,
            excerpt,
            cover_image: cover_image || null,
            category,
            read_time,
            sections,
            tags,
            updated_at: new Date()
        };

        if (published_at) {
             updateData.published_at = new Date(published_at);
        }

        const data = await prisma.blogs.update({
            where: { id },
            data: updateData
        });

        cache.invalidatePattern('blogs:');
        res.json(data);
    } catch (err) {
        console.error("Error updating blog:", err);
        res.status(500).json({ error: "Failed to update blog" });
    }
});

module.exports = router;
