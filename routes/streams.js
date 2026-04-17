const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");

const prisma = new PrismaClient();

/**
 * GET /streams
 * Public: List all streams — CACHED for 5 minutes
 */
router.get("/", async (req, res) => {
    // Check cache
    const cached = cache.get("streams:all");
    if (cached) {
        return res.json(cached);
    }

    try {
        const data = await prisma.streams.findMany({
            orderBy: { created_at: 'asc' }
        });

        const response = {
            streams: data,
            titles: data.map(s => s.title)
        };

        cache.set("streams:all", response, CACHE_TTL.STREAMS);
        res.json(response);
    } catch (err) {
        console.error("GET STREAMS ERROR:", err.message);
        res.status(500).json({ error: "Failed to fetch streams" });
    }
});

/**
 * POST /streams
 * Admin: Create stream — invalidates cache
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const { title, description } = req.body;

    if (!title) {
        return res.status(400).json({ error: "Title is required" });
    }

    try {
        const data = await prisma.streams.create({
            data: { title, description }
        });

        cache.invalidate("streams:all");
        res.json(data);
    } catch (err) {
        console.error("CREATE STREAM ERROR:", err);
        res.status(500).json({ error: "Failed to create stream" });
    }
});

/**
 * PUT /streams/:id
 * Admin: Update stream — invalidates cache
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, description } = req.body;

    try {
        const data = await prisma.streams.update({
            where: { id },
            data: { title, description }
        });

        cache.invalidate("streams:all");
        res.json(data);
    } catch (err) {
        console.error("UPDATE STREAM ERROR:", err);
        res.status(500).json({ error: "Failed to update stream" });
    }
});

/**
 * DELETE /streams/:id
 * Admin: Delete stream — invalidates cache
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.streams.delete({
            where: { id }
        });

        cache.invalidate("streams:all");
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE STREAM ERROR:", err);
        res.status(500).json({ error: "Failed to delete stream" });
    }
});

module.exports = router;
