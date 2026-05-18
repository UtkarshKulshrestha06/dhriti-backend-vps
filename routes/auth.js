const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, getJwtSecret, extractBearerToken, verifyToken } = require('../middleware/auth');
const router = express.Router();
const prisma = new PrismaClient();

const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '7d';

async function getSubscribedBatchIds(user) {
  try {
    if (user.role === 'ADMIN' || user.role === 'TEACHER') {
      const batches = await prisma.batches.findMany({
        select: { id: true }
      });
      return batches.map((batch) => batch.id);
    }

    if (user.role === 'STUDENT') {
      const enrollments = await prisma.enrollments.findMany({
        where: { user_id: user.id },
        select: { batch_id: true }
      });
      return enrollments.map((enrollment) => enrollment.batch_id);
    }
  } catch (error) {
    console.warn('[auth] Could not resolve subscribedBatchIds:', error.message);
  }

  return [];
}

async function buildUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    phone: user.phone || '',
    subject: user.subject || '',
    avatar: user.avatar_url || '',
    subscribedBatchIds: await getSubscribedBatchIds(user)
  };
}

function signAuthToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRY }
  );
}

// Register Route (match frontend /auth/register)
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone number is required' });
    }

    if (!firstName) {
      return res.status(400).json({ error: 'First name is required' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email || `${phone}@phone.dhriti.local` }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email/phone already exists. Please login.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedEmail = email || `${phone}@phone.dhriti.local`;

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        first_name: firstName,
        last_name: lastName,
        phone,
        role: 'USER'
      }
    });

    const token = signAuthToken(user);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      userId: user.id,
      token,
      user: await buildUserResponse(user)
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login Route
router.post('/auth/login', async (req, res) => {
  try {
    // Accept 'identifier' (legacy) or 'email' field
    const { email, identifier, password } = req.body;
    const loginEmail = email || identifier;

    if (!loginEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: loginEmail }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAuthToken(user);
    const userRes = await buildUserResponse(user);

    res.json({
      token,
      session: { access_token: token },
      user: userRes
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Old frontend compatibility route
router.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: identifier }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signAuthToken(user);
    const userRes = await buildUserResponse(user);

    res.json({
      token, // added to fix the "No token returned" issue when hitting this compat route
      session: { access_token: token },
      user: userRes
    });
  } catch (error) {
    console.error('Legacy Login Error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh Endpoint
router.post('/auth/refresh', async (req, res) => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const decoded = verifyToken(token, { ignoreExpiration: true });
    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    const refreshedToken = signAuthToken(user);

    res.json({
      token: refreshedToken,
      user: await buildUserResponse(user)
    });
  } catch (error) {
    console.error('Refresh Error:', error);
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// Get Current User (Protected Route)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(await buildUserResponse(user));
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/auth/reset-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
