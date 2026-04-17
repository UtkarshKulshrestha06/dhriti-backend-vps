const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");

const prisma = new PrismaClient();

// Helper to transform batch data to frontend format
function transformBatch(batch) {
    return {
        id: batch.id,
        title: batch.title,
        subTitle: batch.subtitle,
        description: batch.description,
        category: batch.stream?.title || "",
        streamId: batch.stream_id,
        targetYear: batch.target_year,
        duration: batch.duration,
        price: batch.price,
        registrationFee: batch.registration_fee,
        batchDate: batch.batch_date,
        endDate: batch.end_date,
        syllabusUrl: batch.syllabus_url,
        studentImage: batch.image_url,
        colorTheme: batch.color_theme,
        className: batch.class_name,
        isActive: batch.is_active,
        features: [],
        faculty: []
    };
}

/**
 * GET /batches
 * Public: List all batches — CACHED for 5 minutes
 */
router.get("/", async (req, res) => {
    const { stream } = req.query;
    const cacheKey = `batches:all:${stream || 'none'}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const whereClause = { is_active: true };
        if (stream) {
            whereClause.stream_id = stream;
        }

        const data = await prisma.batches.findMany({
            where: whereClause,
            include: {
                stream: {
                    select: {
                        id: true,
                        title: true
                    }
                }
            },
            orderBy: { created_at: 'asc' }
        });

        const batches = data.map(transformBatch);
        cache.set(cacheKey, batches, CACHE_TTL.BATCHES);
        res.json(batches);
    } catch (err) {
        console.error("GET BATCHES ERROR:", err.message);
        res.status(500).json({ error: "Failed to fetch batches" });
    }
});

/**
 * GET /batches/:id
 * Public: Get single batch — CACHED for 5 minutes
 */
router.get("/:id", async (req, res) => {
    const { id } = req.params;
    const cacheKey = `batches:${id}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const data = await prisma.batches.findUnique({
            where: { id },
            include: {
                stream: {
                    select: {
                        id: true,
                        title: true
                    }
                }
            }
        });

        if (!data) {
            return res.status(404).json({ error: "Batch not found" });
        }

        const batch = transformBatch(data);
        cache.set(cacheKey, batch, CACHE_TTL.BATCHES);
        res.json(batch);
    } catch (err) {
        console.error("GET BATCH ERROR:", err.message);
        res.status(500).json({ error: "Failed to fetch batch" });
    }
});

/**
 * POST /batches
 * Admin: Create batch
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const {
        id,
        stream_id,
        streamId,
        title,
        subtitle,
        subTitle,
        description,
        class_name,
        className,
        target_year,
        targetYear,
        batch_date,
        batchDate,
        end_date,
        endDate,
        duration,
        price,
        registration_fee,
        registrationFee,
        syllabus_url,
        syllabusUrl,
        image_url,
        studentImage,
        color_theme,
        colorTheme
    } = req.body;

    if (!id || !title) {
        return res.status(400).json({ error: "Batch ID and title are required" });
    }

    try {
        const data = await prisma.batches.create({
            data: {
                id,
                stream_id: stream_id || streamId,
                title,
                subtitle: subtitle || subTitle,
                description,
                class_name: class_name || className,
                target_year: target_year || targetYear,
                batch_date: (batch_date || batchDate) ? new Date(batch_date || batchDate) : null,
                end_date: (end_date || endDate) ? new Date(end_date || endDate) : null,
                duration,
                price,
                registration_fee: registration_fee || registrationFee,
                syllabus_url: syllabus_url || syllabusUrl,
                image_url: image_url || studentImage,
                color_theme: color_theme || colorTheme
            }
        });

        cache.invalidatePrefix('batches:');
        res.json(data);
    } catch (err) {
        console.error("CREATE BATCH ERROR:", err);
        res.status(500).json({ error: "Failed to create batch" });
    }
});

/**
 * PUT /batches/:id
 * Admin: Update batch
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const updateData = {};
        if (req.body.title !== undefined) updateData.title = req.body.title;
        if (req.body.subtitle !== undefined || req.body.subTitle !== undefined)
            updateData.subtitle = req.body.subtitle || req.body.subTitle;
        if (req.body.description !== undefined) updateData.description = req.body.description;
        if (req.body.stream_id !== undefined || req.body.streamId !== undefined)
            updateData.stream_id = req.body.stream_id || req.body.streamId;
        if (req.body.class_name !== undefined || req.body.className !== undefined)
            updateData.class_name = req.body.class_name || req.body.className;
        if (req.body.target_year !== undefined || req.body.targetYear !== undefined)
            updateData.target_year = req.body.target_year || req.body.targetYear;
        if (req.body.duration !== undefined) updateData.duration = req.body.duration;
        if (req.body.price !== undefined) updateData.price = req.body.price;
        if (req.body.registration_fee !== undefined || req.body.registrationFee !== undefined)
            updateData.registration_fee = req.body.registration_fee || req.body.registrationFee;
        
        if (req.body.batch_date !== undefined || req.body.batchDate !== undefined) {
            const date = req.body.batch_date || req.body.batchDate;
            updateData.batch_date = date ? new Date(date) : null;
        }
        if (req.body.end_date !== undefined || req.body.endDate !== undefined) {
            const date = req.body.end_date || req.body.endDate;
            updateData.end_date = date ? new Date(date) : null;
        }
            
        if (req.body.syllabus_url !== undefined || req.body.syllabusUrl !== undefined)
            updateData.syllabus_url = req.body.syllabus_url || req.body.syllabusUrl;
        if (req.body.image_url !== undefined || req.body.studentImage !== undefined)
            updateData.image_url = req.body.image_url || req.body.studentImage;
        if (req.body.color_theme !== undefined || req.body.colorTheme !== undefined)
            updateData.color_theme = req.body.color_theme || req.body.colorTheme;
        if (req.body.is_active !== undefined || req.body.isActive !== undefined)
            updateData.is_active = req.body.is_active ?? req.body.isActive;

        const data = await prisma.batches.update({
            where: { id },
            data: updateData
        });

        cache.invalidatePrefix('batches:');
        res.json(data);
    } catch (err) {
        console.error("UPDATE BATCH ERROR:", err);
        res.status(500).json({ error: "Failed to update batch" });
    }
});

/**
 * DELETE /batches/:id
 * Admin: Delete batch
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.batches.delete({
            where: { id }
        });

        cache.invalidatePrefix('batches:');
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE BATCH ERROR:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
});

module.exports = router;
