const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../services/prisma');
const { requireAuth, requireAdmin, requireTeacher } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getSubscribedBatchIds(userId, role) {
  try {
    if (role === 'ADMIN' || role === 'TEACHER') {
      const batches = await prisma.batches.findMany({
        select: { id: true }
      });
      return batches.map((b) => b.id);
    }
    const enrollments = await prisma.enrollments.findMany({
      where: { user_id: userId },
      select: { batch_id: true }
    });
    return enrollments.map((e) => e.batch_id);
  } catch {
    return [];
  }
}

function formatUser(u, subscribedBatchIds = []) {
  return {
    id: u.id,
    firstName: u.first_name || '',
    lastName: u.last_name || '',
    email: u.email,
    role: u.role,
    phone: u.phone || '',
    subject: u.subject || '',
    avatar: u.avatar_url || '',
    createdAt: u.created_at,
    subscribedBatchIds
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /users
 * Teacher+: list all users with their enrolled batch IDs
 */
router.get('/', requireAuth, requireTeacher, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        enrollments: { select: { batch_id: true } }
      }
    });

    res.json(
      users.map((u) =>
        formatUser(u, u.enrollments ? u.enrollments.map((e) => e.batch_id) : [])
      )
    );
  } catch (err) {
    console.error('GET USERS ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /users/:id
 * Authenticated: get a single user by ID
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        enrollments: { select: { batch_id: true } }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(formatUser(user, user.enrollments ? user.enrollments.map((e) => e.batch_id) : []));
  } catch (err) {
    console.error('GET USER ERROR:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * POST /users
 * Admin: create a new user
 */
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, role, firstName, first_name, lastName, last_name, phone, subject } =
    req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: role.toUpperCase(),
        first_name: first_name || firstName || '',
        last_name: last_name || lastName || '',
        phone: phone || '',
        subject: subject || ''
      }
    });

    res.json({
      success: true,
      user: formatUser(newUser)
    });
  } catch (err) {
    console.error('CREATE USER ERROR:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /users/me/profile
 * Self-update: authenticated user updates their own profile
 */
router.put('/me/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, first_name, lastName, last_name, phone, subject, avatar } = req.body;

    const updateData = {};
    if (firstName !== undefined || first_name !== undefined)
      updateData.first_name = first_name || firstName;
    if (lastName !== undefined || last_name !== undefined)
      updateData.last_name = last_name || lastName;
    if (phone !== undefined) updateData.phone = phone || null;
    if (subject !== undefined) updateData.subject = subject;
    if (avatar !== undefined) updateData.avatar_url = avatar;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData
    });

    res.json({
      success: true,
      user: await formatUser(updatedUser, await getSubscribedBatchIds(updatedUser.id, updatedUser.role))
    });
  } catch (err) {
    console.error('UPDATE PROFILE ERROR:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * PUT /users/:id
 * Admin: update any user's profile
 */
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const updateData = {};
    if (req.body.firstName !== undefined || req.body.first_name !== undefined)
      updateData.first_name = req.body.first_name || req.body.firstName;
    if (req.body.lastName !== undefined || req.body.last_name !== undefined)
      updateData.last_name = req.body.last_name || req.body.lastName;
    if (req.body.phone !== undefined) updateData.phone = req.body.phone || null;
    if (req.body.subject !== undefined) updateData.subject = req.body.subject;
    if (req.body.role !== undefined) updateData.role = req.body.role.toUpperCase();

    if (req.body.password) {
      updateData.password = await bcrypt.hash(req.body.password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, user: formatUser(updatedUser) });
  } catch (err) {
    console.error('UPDATE USER ERROR:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Internal server error during update' });
  }
});

/**
 * DELETE /users/:id
 * Admin: delete a user and their enrollments
 */
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Delete BookmarkTagRelations associated with user's tags or bookmarks
      // Since it's a many-to-many, we first find the user's bookmarks and tags
      const userBookmarks = await tx.bookmarks.findMany({ where: { user_id: id }, select: { id: true } });
      const userTags = await tx.questionTags.findMany({ where: { user_id: id }, select: { id: true } });
      
      const bookmarkIds = userBookmarks.map(b => b.id);
      const tagIds = userTags.map(t => t.id);

      if (bookmarkIds.length > 0 || tagIds.length > 0) {
        await tx.bookmarkTagRelations.deleteMany({
          where: {
            OR: [
              { bookmark_id: { in: bookmarkIds } },
              { tag_id: { in: tagIds } }
            ]
          }
        });
      }

      // 2. Cascade delete other relations
      await tx.bookmarks.deleteMany({ where: { user_id: id } });
      await tx.questionTags.deleteMany({ where: { user_id: id } });
      await tx.notebooks.deleteMany({ where: { user_id: id } });
      await tx.testAttempts.deleteMany({ where: { student_id: id } });
      
      // For Tests and Announcements, they might be owned by teachers/admins
      await tx.tests.updateMany({ where: { created_by: id }, data: { created_by: null } });
      await tx.announcements.deleteMany({ where: { author_id: id } });
      await tx.resources.deleteMany({ where: { uploaded_by: id } });
      await tx.siteContent.updateMany({ where: { updated_by: id }, data: { updated_by: null } });
      
      // Finally delete enrollments and the user
      await tx.enrollments.deleteMany({ where: { user_id: id } });
      await tx.user.delete({ where: { id } });
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error('DELETE USER ERROR:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Internal server error during deletion' });
  }
});

module.exports = router;
