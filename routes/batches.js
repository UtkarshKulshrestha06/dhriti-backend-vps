const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");


function normalizeDateOnlyInput(value) {
    if (!value) return null;
    if (value instanceof Date) return value;

    const normalized = String(value).trim();
    if (!normalized) return null;

    const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnlyOutput(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizeCurrencyValue(value) {
    if (value === null || value === undefined) return null;

    const normalized = String(value)
        .replace(/Γé╣|â‚¹|₹/g, "₹")
        .replace(/\s+/g, " ")
        .trim();

    return normalized || null;
}

// Helper to transform batch data to frontend format
function transformBatch(batch) {
    return {
        id: batch.id,
        title: batch.title,
        description: batch.description,
        category: batch.stream?.title || "",
        streamId: batch.stream_id,
        targetYear: batch.target_year,
        duration: batch.duration,
        price: normalizeCurrencyValue(batch.price),
        registrationFee: normalizeCurrencyValue(batch.registration_fee),
        batchDate: formatDateOnlyOutput(batch.batch_date),
        endDate: formatDateOnlyOutput(batch.end_date),
        colorTheme: batch.color_theme,
        className: batch.class_name,
        isActive: batch.is_active,
        admissionsOpen: batch.admissions_open ?? true,
        features: batch.features || [],
        faculty: batch.faculty || []
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
 * GET /batches/admin/all
 * Admin: Get all batches including inactive ones
 */
router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await prisma.batches.findMany({
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
        res.json(batches);
    } catch (err) {
        console.error("GET ADMIN BATCHES ERROR:", err.message);
        res.status(500).json({ error: "Failed to fetch all batches" });
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
        color_theme,
        colorTheme,
        admissions_open,
        admissionsOpen,
        is_active,
        isActive,
        features,
        faculty
    } = req.body;

    if (!title) {
        return res.status(400).json({ error: "Batch title is required" });
    }

    const crypto = require("crypto");
    const finalId = id || crypto.randomUUID();

    try {
        const data = await prisma.batches.create({
            data: {
                id: finalId,
                stream_id: stream_id || streamId,
                title,
                description,
                class_name: class_name || className,
                target_year: target_year || targetYear,
                batch_date: normalizeDateOnlyInput(batch_date || batchDate),
                end_date: normalizeDateOnlyInput(end_date || endDate),
                duration,
                price: normalizeCurrencyValue(price),
                registration_fee: normalizeCurrencyValue(registration_fee || registrationFee),
                color_theme: color_theme || colorTheme,
                is_active: is_active ?? isActive ?? true,
                admissions_open: admissions_open ?? admissionsOpen ?? true,
                features: features || [],
                faculty: faculty || []
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
        if (req.body.description !== undefined) updateData.description = req.body.description;
        if (req.body.stream_id !== undefined || req.body.streamId !== undefined)
            updateData.stream_id = req.body.stream_id || req.body.streamId;
        if (req.body.class_name !== undefined || req.body.className !== undefined)
            updateData.class_name = req.body.class_name || req.body.className;
        if (req.body.target_year !== undefined || req.body.targetYear !== undefined)
            updateData.target_year = req.body.target_year || req.body.targetYear;
        if (req.body.duration !== undefined) updateData.duration = req.body.duration;
        if (req.body.price !== undefined) updateData.price = normalizeCurrencyValue(req.body.price);
        if (req.body.registration_fee !== undefined || req.body.registrationFee !== undefined)
            updateData.registration_fee = normalizeCurrencyValue(req.body.registration_fee || req.body.registrationFee);
        
        if (req.body.batch_date !== undefined || req.body.batchDate !== undefined) {
            const date = req.body.batch_date || req.body.batchDate;
            updateData.batch_date = normalizeDateOnlyInput(date);
        }
        if (req.body.end_date !== undefined || req.body.endDate !== undefined) {
            const date = req.body.end_date || req.body.endDate;
            updateData.end_date = normalizeDateOnlyInput(date);
        }
            
        if (req.body.color_theme !== undefined || req.body.colorTheme !== undefined)
            updateData.color_theme = req.body.color_theme || req.body.colorTheme;
        if (req.body.is_active !== undefined || req.body.isActive !== undefined)
            updateData.is_active = req.body.is_active ?? req.body.isActive;
        if (req.body.admissions_open !== undefined || req.body.admissionsOpen !== undefined)
            updateData.admissions_open = req.body.admissions_open ?? req.body.admissionsOpen;
        if (req.body.features !== undefined)
            updateData.features = req.body.features;
        if (req.body.faculty !== undefined)
            updateData.faculty = req.body.faculty;

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
