const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin, requireTeacher } = require("../middleware/auth");


/**
 * GET /enrollments/batch/:batchId
 * Teacher+: List all users enrolled in a specific batch
 */
router.get("/batch/:batchId", requireAuth, requireTeacher, async (req, res) => {
    const { batchId } = req.params;

    try {
        const data = await prisma.enrollments.findMany({
            where: { batch_id: batchId },
            include: { user: true }
        });

        // Flatten for easier frontend consumption
        const users = data.map(item => ({
            id: item.user.id,
            firstName: item.user.first_name || "",
            lastName: item.user.last_name || "",
            email: item.user.email,
            role: item.user.role,
            phone: item.user.phone || "",
            enrolledAt: item.enrolled_at
        }));

        res.json(users);
    } catch (err) {
        console.error("GET BATCH ENROLLMENTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch enrollments" });
    }
});

/**
 * GET /enrollments/user/:userId
 * Get all batch enrollments for a specific user
 */
router.get("/user/:userId", requireAuth, async (req, res) => {
    const { userId } = req.params;
    const requestingUserRole = req.user?.role;

    // Only Admin or the User themselves can see this
    if (requestingUserRole !== "ADMIN" && req.user.id !== userId) {
        return res.status(403).json({ error: "Unauthorized access" });
    }

    try {
        const data = await prisma.enrollments.findMany({
            where: { user_id: userId },
            select: { batch_id: true, enrolled_at: true }
        });

        res.json(data);
    } catch (err) {
        console.error("GET USER ENROLLMENTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch enrollments" });
    }
});

/**
 * POST /enrollments
 * Admin: Enroll a user in a batch
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    const { user_id, userId, batch_id, batchId } = req.body;

    const finalUserId = user_id || userId;
    const finalBatchId = batch_id || batchId;

    if (!finalUserId || !finalBatchId) {
        return res.status(400).json({ error: "user_id and batch_id are required" });
    }

    try {
        const data = await prisma.enrollments.create({
            data: {
                user_id: finalUserId,
                batch_id: finalBatchId
            }
        });

        res.json({ success: true, data });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ error: "User already enrolled in this batch" });
        }
        console.error("CREATE ENROLLMENT ERROR:", err);
        res.status(500).json({ error: "Failed to create enrollment" });
    }
});

/**
 * POST /enrollments/bulk
 * Admin: Bulk enroll users in a batch
 */
router.post("/bulk", requireAuth, requireAdmin, async (req, res) => {
    const { userIds, batchId } = req.body;

    if (!userIds || !Array.isArray(userIds) || !batchId) {
        return res.status(400).json({ error: "userIds array and batchId are required" });
    }

    try {
        const enrollments = userIds.map(userId => ({
            user_id: userId,
            batch_id: batchId
        }));

        const data = await prisma.enrollments.createMany({
            data: enrollments,
            skipDuplicates: true // like onConflict in Supabase
        });

        res.json({ success: true, enrolled: data.count });
    } catch (err) {
        console.error("BULK ENROLLMENT ERROR:", err);
        res.status(500).json({ error: "Failed to bulk enroll users" });
    }
});

/**
 * DELETE /enrollments
 * Admin: Remove a user from a batch
 */
router.delete("/", requireAuth, requireAdmin, async (req, res) => {
    const { user_id, userId, batch_id, batchId } = req.body;

    const finalUserId = user_id || userId;
    const finalBatchId = batch_id || batchId;

    if (!finalUserId || !finalBatchId) {
        return res.status(400).json({ error: "user_id and batch_id are required" });
    }

    try {
        await prisma.enrollments.delete({
            where: {
                user_id_batch_id: {
                    user_id: finalUserId,
                    batch_id: finalBatchId
                }
            }
        });

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE ENROLLMENT ERROR:", err);
        res.status(500).json({ error: "Failed to remove enrollment" });
    }
});

module.exports = router;
