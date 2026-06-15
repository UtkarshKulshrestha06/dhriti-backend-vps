const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");
const { requireAuth, requireTeacher } = require("../middleware/auth");
const { cache, CACHE_TTL } = require("../services/cache");
const {
    formatDateString,
    formatTimeOnlyString,
    getTodayDateString,
    getTomorrowDateString,
    getDayOfWeekFromDateString,
    toDateOnly
} = require("../services/dateTime");


// Helper: Get stream type for a batch
async function getBatchStreamType(batchId) {
    const batch = await prisma.batches.findUnique({
        where: { id: batchId },
        include: { stream: true }
    });

    if (!batch || !batch.stream) return null;
    return batch.stream.title?.toUpperCase(); // JEE, NEET, or FOUNDATION
}

// Helper: Get default subjects based on stream
function getDefaultSubjects(streamType) {
    switch (streamType) {
        case 'JEE': return ['Physics', 'Chemistry', 'Mathematics'];
        case 'NEET': return ['Physics', 'Chemistry', 'Biology'];
        case 'FOUNDATION': return ['Physics', 'Chemistry', 'Mathematics', 'Biology'];
        default: return ['Physics', 'Chemistry', 'Mathematics'];
    }
}

// Helper: Generate template slots for a date
function generateTemplateSlots(batchId, date, subjects) {
    const timeSlots = [
        { start: '09:00 AM', end: '10:30 AM' },
        { start: '10:45 AM', end: '12:15 PM' },
        { start: '01:00 PM', end: '02:30 PM' },
        { start: '02:45 PM', end: '04:15 PM' }
    ];

    const templates = [];
    const dayOfWeek = getDayOfWeekFromDateString(date);

    subjects.forEach((subject, index) => {
        if (index < timeSlots.length) {
            templates.push({
                id: `template-${date}-${index}`,
                batchId,
                date: toDateOnly(date),
                dayOfWeek,
                time: `${timeSlots[index].start} - ${timeSlots[index].end}`,
                startTime: timeSlots[index].start,
                endTime: timeSlots[index].end,
                subject,
                topic: '',
                faculty: '',
                isCompulsory: true,
                isTemplate: true
            });
        }
    });

    return templates;
}

// Helper: Convert day number to name
function dayNumberToName(dayNum) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayNum] || '';
}

/**
 * GET /timetable
 * Get timetable/schedule for a batch (today and tomorrow only)
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId } = req.query;
    const targetBatchId = batch || batchId;

    if (!targetBatchId) {
        return res.status(400).json({ error: "batch_id is required" });
    }

    const cacheKey = `timetable:${targetBatchId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const todayStr = getTodayDateString();
        const tomorrowStr = getTomorrowDateString();

        const data = await prisma.timetable.findMany({
            where: {
                batch_id: targetBatchId,
                date: {
                    in: [toDateOnly(todayStr), toDateOnly(tomorrowStr)]
                }
            },
            orderBy: [
                { date: 'asc' },
                { start_time: 'asc' }
            ]
        });

        const formatTime = (timeInfo) => {
             if (!timeInfo) return "";
             if (timeInfo instanceof Date) {
                  return formatTimeOnlyString(timeInfo);
             }
             return timeInfo.toString();
        };

        const formatDateStr = (dateObj) => {
             if(!dateObj) return "";
             if(dateObj instanceof Date) {
                  return formatDateString(dateObj);
             }
             return dateObj.toString().split('T')[0];
        }

        // Transform to frontend format
        const schedule = data.map(item => {
            const startTStr = formatTime(item.start_time);
            const endTStr = formatTime(item.end_time);
            return {
                id: item.id,
                batchId: item.batch_id,
                date: formatDateStr(item.date),
                dayOfWeek: dayNumberToName(item.day_of_week),
                time: `${startTStr} - ${endTStr}`,
                startTime: startTStr,
                endTime: endTStr,
                subject: item.subject,
                topic: item.topic,
                faculty: item.faculty,
                isCompulsory: item.is_compulsory ?? true,
                isTemplate: false
            }
        });

        // If no entries exist for today/tomorrow, generate templates
        const streamType = await getBatchStreamType(targetBatchId);
        const subjects = getDefaultSubjects(streamType);

        const todayEntries = schedule.filter(s => s.date === todayStr);
        const tomorrowEntries = schedule.filter(s => s.date === tomorrowStr);

        if (todayEntries.length === 0) {
            schedule.push(...generateTemplateSlots(targetBatchId, todayStr, subjects));
        }
        if (tomorrowEntries.length === 0) {
            schedule.push(...generateTemplateSlots(targetBatchId, tomorrowStr, subjects));
        }

        // Sort by date then time
        schedule.sort((a, b) => {
            const aDate = formatDateStr(a.date);
            const bDate = formatDateStr(b.date);
            if (aDate !== bDate) return aDate.localeCompare(bDate);
            return (a.startTime || '').localeCompare(b.startTime || '');
        });

        cache.set(cacheKey, schedule, CACHE_TTL.AUTH_ROLE); // 2 min
        res.json(schedule);
    } catch (err) {
        console.error("GET TIMETABLE ERROR:", err);
        res.status(500).json({ error: "Failed to fetch timetable" });
    }
});

/**
 * POST /timetable
 * Teacher+: Create schedule entry
 */
router.post("/", requireAuth, requireTeacher, async (req, res) => {
    const {
        batch_id,
        batchId,
        date,
        day_of_week,
        dayOfWeek,
        start_time,
        startTime,
        end_time,
        endTime,
        subject,
        topic,
        faculty,
        is_compulsory,
        isCompulsory
    } = req.body;

    const finalBatchId = batch_id || batchId;

    if (!finalBatchId) {
        return res.status(400).json({ error: "batch_id is required" });
    }

    try {
        const finalDateStr = date || getTodayDateString();

        // Map day names to integers if needed
        const dayNameToInt = { "sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6 };
        let finalDayOfWeek = day_of_week ?? dayOfWeek;

        if (typeof finalDayOfWeek === "string") {
            finalDayOfWeek = dayNameToInt[finalDayOfWeek.toLowerCase()] ?? getDayOfWeekFromDateString(finalDateStr);
        } else if (finalDayOfWeek === undefined || finalDayOfWeek === null) {
            finalDayOfWeek = getDayOfWeekFromDateString(finalDateStr);
        }

        const createData = {
            batch_id: finalBatchId,
            date: toDateOnly(finalDateStr),
            day_of_week: finalDayOfWeek,
            start_time: new Date(`1970-01-01T${(start_time || startTime).trim()}:00Z`),
            end_time: new Date(`1970-01-01T${(end_time || endTime).trim()}:00Z`),
            subject,
            topic,
            faculty,
            is_compulsory: is_compulsory ?? isCompulsory ?? true
        };

        const data = await prisma.timetable.create({
            data: createData
        });

        cache.invalidatePattern('timetable:');

        const formatDateStr = (dateObj) => {
             if(!dateObj) return "";
             if(dateObj instanceof Date) {
                  return formatDateString(dateObj);
             }
             return dateObj.toString().split('T')[0];
        }
        
        const formatTime = (timeInfo) => {
             if (!timeInfo) return "";
             if (timeInfo instanceof Date) {
                  return formatTimeOnlyString(timeInfo);
             }
             return timeInfo.toString();
        };

        // Return in frontend format
        res.json({
            id: data.id,
            batchId: data.batch_id,
            date: formatDateStr(data.date),
            dayOfWeek: dayNumberToName(data.day_of_week),
            time: `${formatTime(data.start_time)} - ${formatTime(data.end_time)}`,
            startTime: formatTime(data.start_time),
            endTime: formatTime(data.end_time),
            subject: data.subject,
            topic: data.topic,
            faculty: data.faculty,
            isCompulsory: data.is_compulsory ?? true,
            isTemplate: false
        });
    } catch (err) {
        console.error("CREATE TIMETABLE ENTRY ERROR:", err);
        res.status(500).json({ error: "Failed to create schedule entry" });
    }
});

/**
 * PUT /timetable/:id
 * Teacher+: Update schedule entry
 */
router.put("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        const updateData = {};

        // Map day names to integers
        const dayNameToInt = { "sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6 };

        if (req.body.date !== undefined) updateData.date = toDateOnly(req.body.date);
        
        if (req.body.day_of_week !== undefined || req.body.dayOfWeek !== undefined) {
            let dow = req.body.day_of_week ?? req.body.dayOfWeek;
            if (typeof dow === "string") {
                dow = dayNameToInt[dow.toLowerCase()] ?? dow;
            }
            updateData.day_of_week = dow;
        }
        if (req.body.start_time !== undefined || req.body.startTime !== undefined) {
            updateData.start_time = new Date(`1970-01-01T${(req.body.start_time || req.body.startTime).trim()}:00Z`);
        }
        if (req.body.end_time !== undefined || req.body.endTime !== undefined) {
            updateData.end_time = new Date(`1970-01-01T${(req.body.end_time || req.body.endTime).trim()}:00Z`);
        }
        if (req.body.subject !== undefined) updateData.subject = req.body.subject;
        if (req.body.topic !== undefined) updateData.topic = req.body.topic;
        if (req.body.faculty !== undefined) updateData.faculty = req.body.faculty;
        if (req.body.is_compulsory !== undefined || req.body.isCompulsory !== undefined) {
            updateData.is_compulsory = req.body.is_compulsory ?? req.body.isCompulsory;
        }

        const data = await prisma.timetable.update({
            where: { id },
            data: updateData
        });

        cache.invalidatePattern('timetable:');

        const formatDateStr = (dateObj) => {
             if(!dateObj) return "";
             if(dateObj instanceof Date) {
                  return formatDateString(dateObj);
             }
             return dateObj.toString().split('T')[0];
        }
        
        const formatTime = (timeInfo) => {
             if (!timeInfo) return "";
             if (timeInfo instanceof Date) {
                  return formatTimeOnlyString(timeInfo);
             }
             return timeInfo.toString();
        };

        // Return in frontend format
        res.json({
            id: data.id,
            batchId: data.batch_id,
            date: formatDateStr(data.date),
            dayOfWeek: dayNumberToName(data.day_of_week),
            time: `${formatTime(data.start_time)} - ${formatTime(data.end_time)}`,
            startTime: formatTime(data.start_time),
            endTime: formatTime(data.end_time),
            subject: data.subject,
            topic: data.topic,
            faculty: data.faculty,
            isCompulsory: data.is_compulsory ?? true,
            isTemplate: false
        });
    } catch (err) {
        console.error("UPDATE TIMETABLE ERROR:", err);
        res.status(500).json({ error: "Failed to update schedule entry" });
    }
});

/**
 * DELETE /timetable/cleanup/old
 * Admin only: Delete timetable entries older than today
 * Can be called by cron job at midnight
 * NOTE: This route MUST be defined BEFORE /:id to avoid Express matching "cleanup" as :id
 */
router.delete("/cleanup/old", requireAuth, requireTeacher, async (req, res) => {
    try {
        const today = toDateOnly(getTodayDateString());

        const data = await prisma.timetable.deleteMany({
            where: {
                date: {
                    lt: today
                }
            }
        });

        res.json({
            success: true,
            deletedCount: data.count || 0,
            message: `Deleted ${data.count || 0} old timetable entries`
        });
    } catch (err) {
        console.error("CLEANUP TIMETABLE ERROR:", err);
        res.status(500).json({ error: "Failed to cleanup old entries" });
    }
});

/**
 * DELETE /timetable/:id
 * Teacher+: Delete schedule entry
 */
router.delete("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.timetable.delete({
            where: { id }
        });

        cache.invalidatePattern('timetable:');
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE TIMETABLE ERROR:", err);
        res.status(500).json({ error: "Failed to delete schedule entry" });
    }
});

module.exports = router;
