const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireTeacher } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");

const prisma = new PrismaClient();

/**
 * GET /announcements
 * Get announcements for a batch
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId } = req.query;
    const targetBatchId = batch || batchId;

    if (!targetBatchId) {
        return res.status(400).json({ error: "batch_id is required" });
    }

    const cacheKey = `announcements:${targetBatchId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const data = await prisma.announcements.findMany({
            where: { batch_id: targetBatchId },
            include: {
                user: {
                    select: { first_name: true, last_name: true }
                }
            },
            orderBy: { created_at: 'desc' }
        });

        // Transform to frontend format
        const announcements = data.map(a => ({
            id: a.id,
            batchId: a.batch_id,
            authorId: a.author_id,
            title: a.title,
            message: a.message,
            date: a.created_at?.toISOString().split("T")[0] || "",
            time: a.created_at?.toISOString().split("T")[1]?.substring(0, 5) || "",
            author: a.user ? `${a.user.first_name || ""} ${a.user.last_name || ""}`.trim() : "Unknown",
            isImportant: a.is_important || false,
            tags: a.tags || [],
            isNew: false
        }));

        cache.set(cacheKey, announcements, CACHE_TTL.AUTH_ROLE); 
        res.json(announcements);
    } catch (err) {
        console.error("GET ANNOUNCEMENTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch announcements" });
    }
});

/**
 * POST /announcements
 * Teacher+: Create announcement
 */
router.post("/", requireAuth, requireTeacher, async (req, res) => {
    const {
        batch_id,
        batchId,
        title,
        message,
        is_important,
        isImportant,
        tags
    } = req.body;

    const finalBatchId = batch_id || batchId;

    if (!finalBatchId || !title || !message) {
        return res.status(400).json({ error: "batch_id, title and message are required" });
    }

    try {
        const data = await prisma.announcements.create({
            data: {
                batch_id: finalBatchId,
                title,
                message,
                is_important: is_important || isImportant || false,
                tags: tags || [],
                author_id: req.user.id
            },
            include: {
                user: {
                    select: { first_name: true, last_name: true }
                }
            }
        });

        cache.invalidatePrefix('announcements:');
        res.json({
            id: data.id,
            batchId: data.batch_id,
            authorId: data.author_id,
            title: data.title,
            message: data.message,
            date: data.created_at?.toISOString().split("T")[0] || "",
            time: data.created_at?.toISOString().split("T")[1]?.substring(0, 5) || "",
            author: data.user ? `${data.user.first_name || ""} ${data.user.last_name || ""}`.trim() : "Unknown",
            isImportant: data.is_important || false,
            tags: data.tags || [],
            isNew: true
        });
    } catch (err) {
        console.error("CREATE ANNOUNCEMENT ERROR:", err);
        res.status(500).json({ error: "Failed to create announcement" });
    }
});

/**
 * PUT /announcements/:id
 * Teacher+: Update announcement
 */
router.put("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;
    const { title, message, is_important, isImportant, tags } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        // Find existing to check ownership
        const existing = await prisma.announcements.findUnique({
            where: { id },
            select: { author_id: true }
        });

        if (!existing) {
            return res.status(404).json({ error: "Announcement not found" });
        }

        // Only Admin or Author can edit
        if (userRole !== "ADMIN" && existing.author_id !== userId) {
            return res.status(403).json({ error: "Unauthorized to edit this announcement" });
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (message !== undefined) updateData.message = message;
        if (is_important !== undefined || isImportant !== undefined) {
            updateData.is_important = is_important ?? isImportant;
        }
        if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];

        const data = await prisma.announcements.update({
            where: { id },
            data: updateData
        });

        cache.invalidatePrefix('announcements:');
        res.json(data);
    } catch (err) {
        console.error("UPDATE ANNOUNCEMENT ERROR:", err);
        res.status(500).json({ error: "Failed to update announcement" });
    }
});

/**
 * DELETE /announcements/:id
 * Teacher+: Delete announcement
 */
router.delete("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        // Find existing to check ownership
        const existing = await prisma.announcements.findUnique({
            where: { id },
            select: { author_id: true }
        });

        if (!existing) {
            return res.status(404).json({ error: "Announcement not found" });
        }

        // Only Admin or Author can delete
        if (userRole !== "ADMIN" && existing.author_id !== userId) {
            return res.status(403).json({ error: "Unauthorized to delete this announcement" });
        }

        await prisma.announcements.delete({
            where: { id }
        });

        cache.invalidatePrefix('announcements:');
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE ANNOUNCEMENT ERROR:", err);
        res.status(500).json({ error: "Failed to delete announcement" });
    }
});

module.exports = router;
