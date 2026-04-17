const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");

const { uploadFile, deleteFile } = require("../services/ftpService");

const prisma = new PrismaClient();

// Multer Memory Storage
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage
    // No file size limit
});

const BASE_URL = process.env.HOSTINGER_PUBLIC_URL || "https://dhriticlasses.com/uploads";
const FTP_BASE_PATH = process.env.FTP_BASE_PATH || "public_html/uploads";

/**
 * POST /freebies/upload
 * Admin: Upload free resource to storage
 */
router.post("/upload", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        const { title, subject, type } = req.body;

        if (!file || !title || !subject || !type) {
            return res.status(400).json({ error: "file, title, subject, and type are required" });
        }

        // Generate unique filename and FTP path
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const fileName = `freebie-${uniqueSuffix}${ext}`;
        const remotePath = `${FTP_BASE_PATH}/freebies/${fileName}`;
        const publicUrl = `${BASE_URL}/freebies/${fileName}`;

        console.log(`Uploading to FTP: ${remotePath}`);
        await uploadFile(file.buffer, remotePath);

        try {
            // Save to DB
            const data = await prisma.freebies.create({
                data: {
                    title,
                    subject,
                    type,
                    file_url: publicUrl
                }
            });

            cache.invalidatePattern('freebies:');
            return res.json(data);
        } catch (dbError) {
            // Delete file if DB insert fails
            const fileNameStr = publicUrl.split('/').pop();
            const remotePathStr = `${FTP_BASE_PATH}/freebies/${fileNameStr}`;
            await deleteFile(remotePathStr).catch(e => console.error("Failed to cleanup FTP file:", e));
            return res.status(500).json({ error: dbError.message });
        }
    } catch (err) {
        console.error("FREEBIE UPLOAD ERROR:", err);
        res.status(500).json({ error: "Upload failed" });
    }
});

/**
 * GET /freebies
 * Public: List free resources
 */
router.get("/", async (req, res) => {
    const { subject, type } = req.query;
    const cacheKey = `freebies:${subject || 'all'}:${type || 'all'}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        // Build the where clause for resources
        const whereClause = {
            batch_id: "freebies"
        };
        
        if (type) {
            whereClause.type = type;
        }

        if (subject && subject !== 'All') {
            whereClause.subject = {
                name: subject
            };
        }

        const data = await prisma.resources.findMany({
            where: whereClause,
            include: {
                subject: true
            },
            orderBy: {
                created_at: 'desc'
            }
        });

        // Transform data to match frontend expectations
        const formattedData = data.map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            file_url: item.file_url,
            created_at: item.created_at,
            subject: item.subject?.name || "General",
            size: "PDF",
            description: item.description || ""
        }));

        cache.set(cacheKey, formattedData, CACHE_TTL.BATCHES);
        res.json(formattedData);
    } catch (err) {
        console.error("GET FREEBIES ERROR:", err);
        res.status(500).json({ error: "Failed to fetch freebies" });
    }
});

/**
 * POST /freebies
 * Admin: Create free resource (Link only)
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const { title, subject, type, file_url, fileUrl } = req.body;

    if (!title || !subject || !type) {
        return res.status(400).json({ error: "title, subject, and type are required" });
    }

    try {
        const data = await prisma.freebies.create({
            data: {
                title,
                subject,
                type,
                file_url: file_url || fileUrl
            }
        });

        cache.invalidatePattern('freebies:');
        res.json(data);
    } catch (err) {
        console.error("CREATE FREEBIE ERROR:", err);
        res.status(500).json({ error: "Failed to create freebie" });
    }
});

/**
 * DELETE /freebies/:id
 * Admin: Delete free resource
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // Fetch file URL first to delete from disk
        const freebie = await prisma.freebies.findUnique({
            where: { id },
            select: { file_url: true }
        });

        if (freebie && freebie.file_url && freebie.file_url.includes("/freebies/")) {
            const fileName = freebie.file_url.split('/').pop();
            if (fileName) {
                const remotePath = `${FTP_BASE_PATH}/freebies/${fileName}`;
                await deleteFile(remotePath).catch(e => console.error("FTP delete failed:", e));
            }
        }

        await prisma.freebies.delete({
            where: { id }
        });

        cache.invalidatePattern('freebies:');
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE FREEBIE ERROR:", err);
        res.status(500).json({ error: "Failed to delete freebie" });
    }
});

module.exports = router;
