const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");

const { uploadFile, deleteFile } = require("../services/ftpService");

const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

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
        const { title, subject, stream, type } = req.body;

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
            // Find subject ID
            const subjectRecord = await prisma.subjects.findFirst({
                where: { name: subject }
            });
            const subjectId = subjectRecord ? subjectRecord.id : null;

            // Save to DB
            const data = await prisma.resources.create({
                data: {
                    batch_id: "freebies",
                    subject_id: subjectId,
                    stream: stream || "General",
                    title,
                    type,
                    file_url: publicUrl,
                    file_size: file.size,
                    is_free: true
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
            stream: item.stream || "General",
            size: item.file_size ? formatBytes(Number(item.file_size)) : "PDF",
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
    const { title, subject, stream, type, file_url, fileUrl } = req.body;

    if (!title || !subject || !type) {
        return res.status(400).json({ error: "title, subject, and type are required" });
    }

    try {
        // Find subject ID
        const subjectRecord = await prisma.subjects.findFirst({
            where: { name: subject }
        });
        const subjectId = subjectRecord ? subjectRecord.id : null;

        const data = await prisma.resources.create({
            data: {
                batch_id: "freebies",
                subject_id: subjectId,
                stream: stream || "General",
                title,
                type,
                file_url: file_url || fileUrl,
                is_free: true
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
        const resource = await prisma.resources.findUnique({
            where: { id },
            select: { file_url: true }
        });

        if (resource && resource.file_url && resource.file_url.includes("/freebies/")) {
            const fileName = resource.file_url.split('/').pop();
            if (fileName) {
                const remotePath = `${FTP_BASE_PATH}/freebies/${fileName}`;
                await deleteFile(remotePath).catch(e => console.error("FTP delete failed:", e));
            }
        }

        await prisma.resources.delete({
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
