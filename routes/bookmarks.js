const express = require('express');
const router = express.Router();
const prisma = require("../services/prisma");
const { requireAuth: verifyToken } = require('../middleware/auth');


// Helper to handle async route errors
const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// --- NOTEBOOKS ---

// GET /api/bookmarks/notebooks
// Get all notebooks for the user, including the count of questions in each
router.get('/notebooks', verifyToken, asyncHandler(async (req, res) => {
    console.log('[bookmarks] GET /notebooks — user:', req.user?.id);
    const notebooks = await prisma.notebooks.findMany({
        where: { user_id: req.user.id },
        include: {
            _count: {
                select: { bookmarks: true }
            }
        },
        orderBy: { created_at: 'desc' }
    });

    const formattedNotebooks = notebooks.map(nb => ({
        id: nb.id,
        user_id: nb.user_id,
        title: nb.title,
        description: nb.description,
        created_at: nb.created_at,
        questionCount: nb._count.bookmarks
    }));

    console.log('[bookmarks] GET /notebooks — returning', formattedNotebooks.length, 'notebooks for user', req.user?.id);
    res.json(formattedNotebooks);
}));

// POST /api/bookmarks/notebooks
// Create a new notebook
router.post('/notebooks', verifyToken, asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    if (!title) {
        return res.status(400).json({ error: "Title is required" });
    }

    try {
        const data = await prisma.notebooks.create({
            data: {
                user_id: req.user.id,
                title,
                description
            }
        });

        res.status(201).json({ ...data, questionCount: 0 });
    } catch (error) {
        console.error("Error creating notebook:", error);
        res.status(500).json({ error: "Failed to create notebook" });
    }
}));

// DELETE /api/bookmarks/notebooks/:id
// Delete a notebook (cascades to all bookmarks inside it)
router.delete('/notebooks/:id', verifyToken, asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const notebook = await prisma.notebooks.findUnique({
            where: { id },
            select: {
                id: true,
                user_id: true,
                bookmarks: {
                    select: { id: true }
                }
            }
        });

        if (!notebook || notebook.user_id !== req.user.id) {
            return res.status(404).json({ error: "Notebook not found" });
        }

        const bookmarkIds = notebook.bookmarks.map((bookmark) => bookmark.id);

        await prisma.$transaction(async (tx) => {
            if (bookmarkIds.length > 0) {
                await tx.bookmarkTagRelations.deleteMany({
                    where: {
                        bookmark_id: { in: bookmarkIds }
                    }
                });

                await tx.bookmarks.deleteMany({
                    where: {
                        notebook_id: id,
                        user_id: req.user.id
                    }
                });
            }

            await tx.notebooks.delete({
                where: { id }
            });
        });

        res.status(204).send();
    } catch (error) {
        console.error("Error deleting notebook:", error);
        res.status(500).json({ error: "Failed to delete notebook" });
    }
}));


// --- TAGS ---

// GET /api/bookmarks/tags
// Get all user tags
router.get('/tags', verifyToken, asyncHandler(async (req, res) => {
    try {
        const data = await prisma.questionTags.findMany({
            where: { user_id: req.user.id },
            orderBy: { name: 'asc' }
        });

        res.json(data);
    } catch (error) {
        console.error("Error fetching tags:", error);
        res.status(500).json({ error: "Failed to fetch tags" });
    }
}));

// POST /api/bookmarks/tags
// Create a new custom tag
router.post('/tags', verifyToken, asyncHandler(async (req, res) => {
    const { name, color } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Tag name is required" });
    }

    try {
        const data = await prisma.questionTags.create({
            data: {
                user_id: req.user.id,
                name,
                color: color || '#3b82f6'
            }
        });

        res.status(201).json(data);
    } catch (error) {
        console.error("Error creating tag:", error);
        // Handle unique constraint violation (Prisma error code P2002)
        if (error.code === 'P2002') {
            return res.status(409).json({ error: "Tag with this name already exists" });
        }
        res.status(500).json({ error: "Failed to create tag" });
    }
}));


// --- BOOKMARKS (QUESTIONS) ---

// GET /api/bookmarks/notebooks/:notebookId/questions
// Get questions inside a notebook with offset/limit chunking
router.get('/notebooks/:notebookId/questions', verifyToken, asyncHandler(async (req, res) => {
    const { notebookId } = req.params;
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 10;
    const tagFilter = req.query.tagId; // Optional single tag filter

    try {
        const whereClause = {
            notebook_id: notebookId,
            user_id: req.user.id
        };

        if (tagFilter) {
            const tagIds = tagFilter.split(',');
            whereClause.bookmarkTagRelations = {
                 some: {
                     tag_id: { in: tagIds }
                 }
            };
        }

        const [count, bookmarks] = await prisma.$transaction([
            prisma.bookmarks.count({ where: whereClause }),
            prisma.bookmarks.findMany({
                where: whereClause,
                include: {
                    bookmarkTagRelations: {
                        include: {
                            tag: true
                        }
                    }
                },
                skip: offset,
                take: limit,
                orderBy: { created_at: 'desc' }
            })
        ]);

        if (bookmarks.length === 0) {
             return res.json({ data: [], count: 0 });
        }

        const testIds = [...new Set(bookmarks.map(b => b.test_id))];

        let testsMap = {};
        if (testIds.length > 0) {
            const tests = await prisma.tests.findMany({
                where: { id: { in: testIds } },
                select: { id: true, name: true, questions: true }
            });

            tests.forEach(t => {
                testsMap[t.id] = { name: t.name, questions: t.questions || [] };
            });
        }

        // Map bookmarks to their actual question JSON payload
        const populatedBookmarks = bookmarks.map(b => {
             const testData = testsMap[b.test_id] || { name: 'Unknown Test', questions: [] };
             const testQuestions = testData.questions;
             const qIndex = testQuestions.findIndex(q => String(q.id) === String(b.question_id));
             const questionData = qIndex !== -1 ? testQuestions[qIndex] : null;

             return {
                 id: b.id,
                 notebook_id: b.notebook_id,
                 test_id: b.test_id,
                 test_name: testData.name,
                 question_number: qIndex !== -1 ? qIndex + 1 : 0,
                 question_id: b.question_id,
                 notes: b.notes,
                 created_at: b.created_at,
                 questionData, 
                 tags: b.bookmarkTagRelations.map(rel => rel.tag)
             };
        }).filter(b => b.questionData);

        res.json({
            data: populatedBookmarks,
            count: count
        });

    } catch (error) {
        console.error("Error fetching bookmarks:", error);
        res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
}));

// GET /api/bookmarks/bookmarked-ids
// Get an array of all bookmarked question IDs for the current user
router.get('/bookmarked-ids', verifyToken, asyncHandler(async (req, res) => {
    try {
        const data = await prisma.bookmarks.findMany({
            where: { user_id: req.user.id },
            select: { question_id: true }
        });

        const ids = data.map(b => b.question_id);
        res.json(ids);
    } catch (error) {
        console.error("Error fetching bookmarked IDs:", error);
        res.status(500).json({ error: "Failed to fetch bookmarked IDs" });
    }
}));

// GET /api/bookmarks/question/:questionId
// Get notebook and tag details for a specific question for the current user
router.get('/question/:questionId', verifyToken, asyncHandler(async (req, res) => {
    const { questionId } = req.params;

    try {
        const bookmarks = await prisma.bookmarks.findMany({
            where: {
                question_id: questionId,
                user_id: req.user.id
            },
            include: {
                bookmarkTagRelations: {
                     select: { tag_id: true }
                }
            }
        });

        if (!bookmarks || bookmarks.length === 0) {
            return res.json({ notebookIds: [], tagIds: [] });
        }

        const notebookIds = bookmarks.map(b => b.notebook_id);

        const tagIds = new Set();
        bookmarks.forEach(b => {
             b.bookmarkTagRelations.forEach(rel => tagIds.add(rel.tag_id));
        });

        res.json({
            notebookIds,
            tagIds: Array.from(tagIds)
        });
    } catch (error) {
        console.error("Error fetching question bookmark details:", error);
        res.status(500).json({ error: "Failed to fetch question bookmark details" });
    }
}));

// POST /api/bookmarks
router.post('/', verifyToken, asyncHandler(async (req, res) => {
    const { notebookId, notebookIds, testId, questionId, tags, notes } = req.body;

    const targetNotebookIds = notebookIds || (notebookId ? [notebookId] : []);

    try {
        if (targetNotebookIds.length === 0) {
            // If entirely deselected, just delete all bookmarks for this question
            await prisma.bookmarks.deleteMany({
                where: {
                    user_id: req.user.id,
                    question_id: questionId
                }
            });
            return res.status(200).json({ message: "Bookmarks removed" });
        }

        if (!testId || !questionId) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // 1. Remove from notebooks NOT in targetNotebookIds
        await prisma.bookmarks.deleteMany({
            where: {
                 user_id: req.user.id,
                 question_id: questionId,
                 notebook_id: { notIn: targetNotebookIds }
            }
        });

        const insertedBookmarks = [];

        // 2. Insert or Ignore for target notebooks
        for (const nId of targetNotebookIds) {
            // Find existing
            let bookmark = await prisma.bookmarks.findFirst({
                 where: {
                      user_id: req.user.id,
                      notebook_id: nId,
                      question_id: questionId
                 }
            });

            if (!bookmark) {
                 bookmark = await prisma.bookmarks.create({
                      data: {
                          user_id: req.user.id,
                          notebook_id: nId,
                          test_id: testId,
                          question_id: questionId,
                          notes
                      }
                 });
            } else if (notes !== undefined) {
                 // Update notes if provided
                 bookmark = await prisma.bookmarks.update({
                      where: { id: bookmark.id },
                      data: { notes }
                 });
            }

            insertedBookmarks.push(bookmark);

            // 3. Sync Tags for this bookmark instance
            if (bookmark && tags && Array.isArray(tags)) {
                 await prisma.bookmarkTagRelations.deleteMany({
                     where: { bookmark_id: bookmark.id }
                 });

                 if (tags.length > 0) {
                     const relations = tags.map(tagId => ({
                          bookmark_id: bookmark.id,
                          tag_id: tagId
                     }));

                     await prisma.bookmarkTagRelations.createMany({
                          data: relations
                     });
                 }
            }
        }

        res.status(200).json(insertedBookmarks[0] || { message: "Synced successfully" });
    } catch (error) {
         console.error("Error syncing bookmarks:", error);
         res.status(500).json({ error: "Failed to sync bookmarks" });
    }
}));

// DELETE /api/bookmarks/:id
// Remove a bookmark
router.delete('/:id', verifyToken, asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const existing = await prisma.bookmarks.findUnique({
            where: { id }
        });

        if (!existing || existing.user_id !== req.user.id) {
            return res.status(404).json({ error: "Bookmark not found" });
        }

        await prisma.$transaction(async (tx) => {
            await tx.bookmarkTagRelations.deleteMany({
                where: { bookmark_id: id }
            });

            await tx.bookmarks.delete({
                where: { id }
            });
        });

        res.status(204).send();
    } catch (error) {
        console.error("Error deleting bookmark:", error);
        res.status(500).json({ error: "Failed to remove bookmark" });
    }
}));

// PUT /api/bookmarks/:id/tags
// Update tags for a specific bookmark
router.put('/:id/tags', verifyToken, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { tags } = req.body; // Array of tag IDs

    try {
        // First verify user owns the bookmark
        const bookmark = await prisma.bookmarks.findUnique({
            where: { id: id },
            select: { id: true, user_id: true }
        });

        if (!bookmark || bookmark.user_id !== req.user.id) {
             return res.status(404).json({ error: "Bookmark not found" });
        }

        // Delete existing relations
        await prisma.bookmarkTagRelations.deleteMany({
            where: { bookmark_id: id }
        });

        // Insert new relations if array provided
        if (tags && Array.isArray(tags) && tags.length > 0) {
             const relations = tags.map(tagId => ({
                 bookmark_id: id,
                 tag_id: tagId
             }));

             await prisma.bookmarkTagRelations.createMany({
                 data: relations
             });
        }

        res.status(200).json({ success: true });
    } catch (error) {
         console.error("Error updating tags:", error);
         res.status(500).json({ error: "Failed to update tags" });
    }
}));

module.exports = router;
