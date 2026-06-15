const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");
const { requireAuth, requireTeacher } = require("../middleware/auth");


/**
 * GET /chapters
 * Get chapters, optionally filtered by batch and subject
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId, subject, subjectId } = req.query;
    const targetBatchId = batch || batchId;
    const targetSubjectId = subject || subjectId;

    try {
        const whereClause = {};

        if (targetBatchId) {
            whereClause.batch_id = targetBatchId;
        }

        // If subject is provided (name or ID)
        if (targetSubjectId) {
            // Check if it's a UUID
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetSubjectId);

            if (isUUID) {
                whereClause.subject_id = targetSubjectId;
            } else if (targetBatchId) {
                // It's a name, and we have a batch ID to scope it
                // We need to fetch the subject ID first
                const subData = await prisma.subjects.findFirst({
                    where: {
                        batch_id: targetBatchId,
                        name: targetSubjectId
                    },
                    select: { id: true }
                });

                if (subData) {
                    whereClause.subject_id = subData.id;
                } else {
                    // Subject name provided but not found for this batch
                    return res.json([]);
                }
            } else {
                return res.json([]);
            }
        }

        const data = await prisma.chapters.findMany({
            where: whereClause,
            include: {
                subject: {
                    select: { name: true }
                }
            },
            orderBy: { chapter_number: 'asc' }
        });

        // Transform to frontend format
        const chapters = data.map(ch => ({
            id: ch.id,
            subjectId: ch.subject_id,
            subject: ch.subject?.name || "",
            batchId: ch.batch_id,
            title: ch.title,
            chapterNumber: ch.chapter_number,
            isNew: false 
        }));

        res.json(chapters);
    } catch (err) {
        console.error("GET CHAPTERS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch chapters" });
    }
});

/**
 * POST /chapters
 * Teacher+: Create chapter
 */
router.post("/", requireAuth, requireTeacher, async (req, res) => {
    const {
        batch_id,
        batchId,
        subject_id,
        subjectId,
        subject, // For compatibility with frontend sending subject name
        title,
        chapter_number,
        chapterNumber
    } = req.body;

    const finalBatchId = batch_id || batchId;
    let finalSubjectId = subject_id || subjectId;

    if (!title) {
        return res.status(400).json({ error: "title is required" });
    }

    try {
        // If subject name is provided instead of ID, look it up or create it
        if (!finalSubjectId && subject && finalBatchId) {
            const subjectData = await prisma.subjects.findFirst({
                where: {
                    batch_id: finalBatchId,
                    name: subject
                },
                select: { id: true }
            });

            if (subjectData) {
                finalSubjectId = subjectData.id;
            } else {
                // Auto-create subject for this batch
                console.log(`Auto-creating subject "${subject}" for batch "${finalBatchId}"`);
                try {
                    const newSubject = await prisma.subjects.create({
                        data: {
                            batch_id: finalBatchId,
                            name: subject
                        },
                        select: { id: true }
                    });
                    finalSubjectId = newSubject.id;
                } catch (createError) {
                    console.error("Failed to auto-create subject:", createError);
                }
            }
        }

        const data = await prisma.chapters.create({
            data: {
                batch_id: finalBatchId,
                subject_id: finalSubjectId,
                title,
                chapter_number: parseInt(chapter_number || chapterNumber || 1)
            }
        });

        res.json({
            id: data.id,
            subjectId: data.subject_id,
            subject: subject || "",
            batchId: data.batch_id,
            title: data.title,
            chapterNumber: data.chapter_number,
            isNew: true
        });
    } catch (err) {
        console.error("CREATE CHAPTER ERROR:", err);
        res.status(500).json({ error: "Failed to create chapter" });
    }
});

/**
 * DELETE /chapters/:id
 * Teacher+: Delete chapter
 */
router.delete("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.chapters.delete({
            where: { id }
        });

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE CHAPTER ERROR:", err);
        res.status(500).json({ error: "Failed to delete chapter" });
    }
});

module.exports = router;
