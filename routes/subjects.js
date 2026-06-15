const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");
const { requireAuth, requireTeacher } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");


/**
 * GET /subjects
 * Get subjects, optionally filtered by batch
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId } = req.query;
    const targetBatchId = batch || batchId;
    const cacheKey = `subjects:${targetBatchId || 'all'}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const whereClause = {};
        if (targetBatchId) {
            whereClause.batch_id = targetBatchId;
        }

        const data = await prisma.subjects.findMany({
            where: whereClause,
            orderBy: { order_index: 'asc' }
        });

        cache.set(cacheKey, data, CACHE_TTL.BATCHES || 300000); // 5 min
        res.json(data);
    } catch (err) {
        console.error("GET SUBJECTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch subjects" });
    }
});

/**
 * POST /subjects
 * Teacher+: Create subject
 */
router.post("/", requireAuth, requireTeacher, async (req, res) => {
    const { batch_id, batchId, name, order_index, orderIndex } = req.body;

    const finalBatchId = batch_id || batchId;

    if (!finalBatchId || !name) {
        return res.status(400).json({ error: "batch_id and name are required" });
    }

    try {
        const data = await prisma.subjects.create({
            data: {
                batch_id: finalBatchId,
                name,
                order_index: order_index || orderIndex || 0
            }
        });

        cache.invalidatePrefix('subjects:');
        res.json(data);
    } catch (err) {
        console.error("CREATE SUBJECT ERROR:", err);
        res.status(500).json({ error: "Failed to create subject" });
    }
});

/**
 * DELETE /subjects/:id
 * Teacher+: Delete subject
 */
router.delete("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.subjects.delete({
            where: { id }
        });

        cache.invalidatePrefix('subjects:');
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE SUBJECT ERROR:", err);
        res.status(500).json({ error: "Failed to delete subject" });
    }
});

module.exports = router;
