require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();

const insecureSecrets = new Set(['your-super-secret-jwt-key']);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGINS,
  'https://dhriticlasses.com',
  'https://www.dhriticlasses.com',
  'http://localhost:5173',
  'http://localhost:3000'
]
  .filter(Boolean)
  .flatMap((value) => value.split(','))
  .map((value) => value.trim())
  .filter(Boolean);

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required to start backend-vps');
}

if (insecureSecrets.has(process.env.JWT_SECRET) && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be replaced with a strong secret in production');
}

if (insecureSecrets.has(process.env.JWT_SECRET) && process.env.NODE_ENV !== 'production') {
  console.warn('[security] JWT_SECRET is using the development placeholder. Replace it before deployment.');
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.some((allowedOrigin) => origin.startsWith(allowedOrigin))
    ) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;

  res.send = function sendWithTiming(body) {
    if (!res.headersSent) {
      res.setHeader('X-Process-Time', Date.now() - start);
    }
    return originalSend.call(this, body);
  };

  next();
});

const streamsRoutes = require('./routes/streams');
const batchesRoutes = require('./routes/batches');
const subjectsRoutes = require('./routes/subjects');
const chaptersRoutes = require('./routes/chapters');
const resourcesRoutes = require('./routes/resources');
const enrollmentsRoutes = require('./routes/enrollments');
const announcementsRoutes = require('./routes/announcements');
const freebiesRoutes = require('./routes/freebies');
const inquiriesRoutes = require('./routes/inquiries');
const siteContentRoutes = require('./routes/siteContent');
const timetableRoutes = require('./routes/timetable');
const testsRoutes = require('./routes/tests');
const blogsRoutes = require('./routes/blogs');
const bookmarksRoutes = require('./routes/bookmarks');

function mountRoute(prefix, router, aliases = []) {
  const allPrefixes = [prefix, ...aliases];

  for (const routePrefix of allPrefixes) {
    app.use(routePrefix, router);
  }
}

// Root mounts preserve compatibility for non-prefixed callers.
mountRoute('/', authRoutes, ['/api', '/api/api']);
mountRoute('/users', userRoutes, ['/api/users']);
mountRoute('/streams', streamsRoutes, ['/api/streams']);
mountRoute('/batches', batchesRoutes, ['/api/batches']);
mountRoute('/subjects', subjectsRoutes, ['/api/subjects']);
mountRoute('/chapters', chaptersRoutes, ['/api/chapters']);
mountRoute('/resources', resourcesRoutes, ['/api/resources']);
mountRoute('/enrollments', enrollmentsRoutes, ['/api/enrollments']);
mountRoute('/announcements', announcementsRoutes, ['/api/announcements']);
mountRoute('/freebies', freebiesRoutes, ['/api/freebies']);
mountRoute('/inquiries', inquiriesRoutes, ['/api/inquiries']);
mountRoute('/site-content', siteContentRoutes, ['/api/site-content']);
mountRoute('/timetable', timetableRoutes, ['/api/timetable']);
mountRoute('/tests', testsRoutes, ['/api/tests']);
mountRoute('/blogs', blogsRoutes, ['/api/blogs']);
mountRoute('/bookmarks', bookmarksRoutes, ['/api/bookmarks', '/api/api/bookmarks']);

app.get('/ping', (req, res) => {
  res.status(200).send('Server alive');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running without Supabase!' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running without Supabase!' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
