const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireTeacher } = require("../middleware/auth");

const { uploadFile, deleteFile } = require("../services/ftpService");

const prisma = new PrismaClient();

// Multer Memory Storage (since we are on Render and uploading via FTP)
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage
});

const BASE_URL = process.env.HOSTINGER_PUBLIC_URL || "https://dhriticlasses.com/uploads";
const FTP_BASE_PATH = process.env.FTP_BASE_PATH || "public_html/uploads";

/**
 * GET /resources
 * Get resources for a batch, optionally filtered by subject and chapter
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId, subject, subjectId, chapter, chapterId } = req.query;
    const targetBatchId = batch || batchId;
    const targetSubjectId = subject || subjectId;
    const targetChapterId = chapter || chapterId;

    try {
        const whereClause = {};

        if (targetBatchId) {
            whereClause.batch_id = targetBatchId;
        }

        if (targetSubjectId) {
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetSubjectId);

            if (isUUID) {
                whereClause.subject_id = targetSubjectId;
            } else if (targetBatchId) {
                const subData = await prisma.subjects.findFirst({
                    where: { batch_id: targetBatchId, name: targetSubjectId },
                    select: { id: true }
                });

                if (subData) {
                    whereClause.subject_id = subData.id;
                } else {
                    return res.json([]);
                }
            } else {
                return res.json([]);
            }
        }
        
        if (targetChapterId) {
            whereClause.chapter_id = targetChapterId;
        }

        const data = await prisma.resources.findMany({
            where: whereClause,
            include: {
                chapter: { select: { title: true } },
                subject: { select: { name: true } }
            },
            orderBy: { created_at: 'desc' }
        });

        // Transform to frontend format
        const resources = data.map(r => ({
            id: r.id,
            chapterId: r.chapter_id,
            chapterTitle: r.chapter?.title || "",
            subjectId: r.subject_id,
            subjectName: r.subject?.name || "",
            batchId: r.batch_id,
            title: r.title,
            type: r.type,
            url: r.file_url,
            fileSize: r.file_size ? Number(r.file_size) : null,
            uploadDate: r.created_at,
            uploadedBy: r.uploaded_by,
            isFree: r.is_free,
            isNew: false
        }));

        res.json(resources);
    } catch (err) {
        console.error("GET RESOURCES ERROR:", err);
        res.status(500).json({ error: "Failed to fetch resources" });
    }
});

router.post(
    "/upload",
    requireAuth,
    requireTeacher,
    upload.single("file"),
    async (req, res) => {
        try {
            const file = req.file;
            const {
                batch_id,
                batchId,
                subject_id,
                subjectId,
                chapter_id,
                chapterId,
                title,
                type
            } = req.body;

            const finalBatchId = batch_id || batchId;
            let finalSubjectId = subject_id || subjectId;
            const finalChapterId = chapter_id || chapterId;
            const subjectName = req.body.subject; // Added this

            if (!file || !title || !type) {
                return res.status(400).json({
                    error: "file, title, and type are required"
                });
            }

            // If subject name is provided instead of ID, look it up or create it
            if (!finalSubjectId && subjectName && finalBatchId) {
                const subjectData = await prisma.subjects.findFirst({
                    where: { batch_id: finalBatchId, name: subjectName },
                    select: { id: true }
                });

                if (subjectData) {
                    finalSubjectId = subjectData.id;
                } else {
                    try {
                        const newSubject = await prisma.subjects.create({
                            data: { batch_id: finalBatchId, name: subjectName },
                            select: { id: true }
                        });
                        finalSubjectId = newSubject.id;
                    } catch (createError) {
                        console.error("Failed to auto-create subject:", createError);
                    }
                }
            }

            // Generate unique filename and FTP path
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            const fileName = `resource-${uniqueSuffix}${ext}`;
            const remotePath = `${FTP_BASE_PATH}/resources/${fileName}`;
            const publicUrl = `${BASE_URL}/resources/${fileName}`;

            await uploadFile(file.buffer, remotePath);

            // Verify user exists
            const userExists = await prisma.user.findUnique({ where: { id: req.user.id } });
            const uploaderId = userExists ? req.user.id : null;

            let validChapterId = null;
            if (finalChapterId) {
                const chapterExists = await prisma.chapters.findUnique({ where: { id: finalChapterId } });
                validChapterId = chapterExists ? finalChapterId : null;
            }

            let validBatchId = null;
            if (finalBatchId) {
                const batchExists = await prisma.batches.findUnique({ where: { id: finalBatchId } });
                validBatchId = batchExists ? finalBatchId : null;
            }

            let validSubjectId = null;
            if (finalSubjectId) {
                const subjectExists = await prisma.subjects.findUnique({ where: { id: finalSubjectId } });
                validSubjectId = subjectExists ? finalSubjectId : null;
            }

            try {
                const data = await prisma.resources.create({
                    data: {
                        batch_id: validBatchId,
                        subject_id: validSubjectId,
                        chapter_id: validChapterId,
                        title,
                        type,
                        file_url: publicUrl,
                        file_size: file.size,
                        uploaded_by: uploaderId
                    }
                });

                res.json({
                    id: data.id,
                    chapterId: data.chapter_id,
                    subjectId: data.subject_id,
                    batchId: data.batch_id,
                    title: data.title,
                    type: data.type,
                    url: data.file_url,
                    fileSize: Number(data.file_size),
                    uploadDate: data.created_at,
                    isNew: true
                });

            } catch (error) {
                console.error("❌ DB INSERT ERROR:", error);
                await deleteFile(remotePath).catch(e => console.error("Failed to cleanup FTP file:", e));
                return res.status(500).json({ error: error.message, details: error });
            }

        } catch (err) {
            console.error("UPLOAD ERROR:", err);
            res.status(500).json({
                error: "Upload failed",
                message: err.message
            });
        }
    }
);

/**
 * PUT /resources/:id
 * Teacher+: Update resource metadata
 */
router.put("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;
    const { title, type, is_free, isFree } = req.body;

    try {
        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (type !== undefined) updateData.type = type;
        if (is_free !== undefined || isFree !== undefined) {
            updateData.is_free = is_free ?? isFree;
        }

        const data = await prisma.resources.update({
            where: { id },
            data: updateData
        });

        res.json({
            ...data,
            fileSize: data.file_size ? Number(data.file_size) : null
        });
    } catch (err) {
        console.error("UPDATE RESOURCE ERROR:", err);
        res.status(500).json({ error: "Failed to update resource" });
    }
});

/**
 * DELETE /resources/:id
 * Teacher+: Delete resource and file from storage
 */
router.delete("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        const resource = await prisma.resources.findUnique({
            where: { id },
            select: { file_url: true }
        });

        if (!resource) {
            return res.status(404).json({ error: "Resource not found" });
        }

        // Check if it's an FTP Hosted file
        if (resource.file_url.includes("/resources/")) {
            const fileName = resource.file_url.split('/').pop();
            if (fileName) {
                const remotePath = `${FTP_BASE_PATH}/resources/${fileName}`;
                await deleteFile(remotePath).catch(e => console.error("FTP delete failed:", e));
            }
        }

        await prisma.resources.delete({
            where: { id }
        });

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE RESOURCE ERROR:", err);
        res.status(500).json({ error: "Failed to delete resource" });
    }
});

module.exports = router;
