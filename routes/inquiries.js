const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");
const { sendInquiryNotification } = require("../services/mailService");
const { requireAuth, requireAdmin } = require("../middleware/auth");


/**
 * GET /inquiries
 * Admin: List all contact inquiries
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
    const { status } = req.query;

    try {
        const whereClause = {};
        if (status) {
            whereClause.status = status;
        }

        const data = await prisma.inquiries.findMany({
            where: whereClause,
            orderBy: {
                created_at: 'desc'
            }
        });

        res.json(data);
    } catch (err) {
        console.error("GET INQUIRIES ERROR:", err);
        res.status(500).json({ error: "Failed to fetch inquiries" });
    }
});

/**
 * POST /inquiries
 * Public: Submit contact form
 */
router.post("/", async (req, res) => {
    const { name, email, phone, message, batch_interest, batchInterest } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ error: "Name and phone are required" });
    }

    try {
        const payload = {
            name,
            email,
            phone,
            message,
            batch_interest: batch_interest || batchInterest,
            status: "pending"
        };

        const data = await prisma.inquiries.create({
            data: payload
        });

        // Send Email Notification asynchronously
        sendInquiryNotification({
            name,
            email,
            phone,
            message,
            batchInterest: batch_interest || batchInterest
        }).catch(err => console.error("Async Email Error:", err));

        res.json({ success: true, id: data.id });
    } catch (err) {
        console.error("CREATE INQUIRY ERROR:", err);
        res.status(500).json({ error: "Failed to submit inquiry" });
    }
});

/**
 * PUT /inquiries/:id
 * Admin: Update inquiry status
 */
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        const data = await prisma.inquiries.update({
            where: { id },
            data: { status }
        });

        res.json(data);
    } catch (err) {
        console.error("UPDATE INQUIRY ERROR:", err);
        res.status(500).json({ error: "Failed to update inquiry" });
    }
});

/**
 * DELETE /inquiries/:id
 * Admin: Delete inquiry
 */
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.inquiries.delete({
            where: { id }
        });

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE INQUIRY ERROR:", err);
        res.status(500).json({ error: "Failed to delete inquiry" });
    }
});

module.exports = router;
