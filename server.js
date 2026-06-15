require('dotenv').config();
process.env.TZ = process.env.APP_TIME_ZONE || process.env.TZ || 'Asia/Kolkata';
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();
app.use(compression());

const insecureSecrets = new Set(['your-super-secret-jwt-key']);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGINS,
  'https://dhriticlasses.com',
  'https://www.dhriticlasses.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173'
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

const isLocalOrigin = (origin) => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) || // 172.16.0.0 - 172.31.255.255
      hostname.endsWith('.local')
    );
  } catch (e) {
    return false;
  }
};

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.some((allowedOrigin) => origin.startsWith(allowedOrigin)) ||
      isLocalOrigin(origin)
    ) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '35mb' }));


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
const youtubeVideosRoutes = require('./routes/youtubeVideos');
const timetableRoutes = require('./routes/timetable');
const testsRoutes = require('./routes/tests');
const quizzesRoutes = require('./routes/quizzes');
const blogsRoutes = require('./routes/blogs');
const bookmarksRoutes = require('./routes/bookmarks');
const seoRenderRoutes = require('./routes/seoRender');

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
mountRoute('/youtube-videos', youtubeVideosRoutes, ['/api/youtube-videos']);
mountRoute('/timetable', timetableRoutes, ['/api/timetable']);
mountRoute('/tests', testsRoutes, ['/api/tests']);
mountRoute('/quizzes', quizzesRoutes, ['/api/quizzes']);
mountRoute('/blogs', blogsRoutes, ['/api/blogs']);
mountRoute('/bookmarks', bookmarksRoutes, ['/api/bookmarks', '/api/api/bookmarks']);
mountRoute('/render', seoRenderRoutes);

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

// Global Error Handler
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Test payload too large. Reduce embedded images or split the test into smaller parts.'
    });
  }
  console.error("Unhandled Global Error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

const os = require('os');
const PORT = process.env.PORT || 3001;

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`- Local Access: http://localhost:${PORT}`);
  const localIps = getLocalIpAddresses();
  localIps.forEach(ip => {
    console.log(`- Network Access: http://${ip}:${PORT}`);
  });
});
