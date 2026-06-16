const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const sharp = require("sharp");
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { uploadFile } = require("../services/ftpService");
const { cache, CACHE_TTL } = require("../services/cache");
const { formatDateString } = require("../services/dateTime");
const { prerenderAndUploadBlog, prerenderAndUploadBlogListing, deletePrerenderedBlog, prerenderAndUploadBlogSitemap } = require("../services/seoPrerenderer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const BASE_URL = process.env.HOSTINGER_PUBLIC_URL || "https://dhriticlasses.com/uploads";
const FTP_BASE_PATH = process.env.FTP_BASE_PATH || "public_html/uploads";
const SITE_URL = process.env.PUBLIC_SITE_URL || "https://dhriticlasses.com";

// IndexNow: Instantly notify search engines when a blog is published
const pingIndexNow = async (urls) => {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return;
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: new URL(SITE_URL).hostname,
        key,
        urlList: urls
      })
    });
    console.log(`[IndexNow] Pinged ${urls.length} URLs, status: ${response.status}`);
  } catch (err) {
    console.warn('[IndexNow] Ping failed (non-blocking):', err.message);
  }
};

const PUBLIC_POST_SELECT = {
  author: true,
};

const STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
};

const normalizeSlug = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const asArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => typeof item === "string" ? item.split(",") : [item])
      .map((item) => typeof item === "string" ? item.trim() : item)
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const stripEmpty = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return value;
};

const firstOrNull = (value) => asArray(value)[0] || null;

const jsonArrayHas = (value) => ({
  path: "$",
  array_contains: value,
});

const taxonomyFilterGroups = ({ exam, subject, topicId }) => [
  exam ? { exams: jsonArrayHas(String(exam)) } : null,
  subject ? { subjects: jsonArrayHas(String(subject)) } : null,
  topicId ? { topic_ids: jsonArrayHas(topicId) } : null,
].filter(Boolean);

const estimateReadTime = (blocks = []) => {
  const collectText = (block) => {
    if (!block) return "";
    if (typeof block.content === "string") return block.content;
    if (Array.isArray(block.content)) return block.content.join(" ");
    if (block.type === "table") return (block.rows || []).flat().join(" ");
    if (block.type === "faq") return (block.items || []).map((item) => `${item.question} ${item.answer}`).join(" ");
    return "";
  };

  const words = blocks.flatMap((block) => collectText(block).split(/\s+/)).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 180))} min read`;
};

const getBlocks = (body) => body.content_blocks || body.sections || [];

const normalizeBlock = (block, index) => {
  const type = block?.type;
  const id = block?.id || `block-${Date.now()}-${index}`;

  if (!type) return null;

  if (type === "heading") {
    const level = Number(block.level || 2);
    return {
      id,
      type,
      level: Math.min(4, Math.max(2, level)),
      content: String(block.content || "").trim(),
    };
  }

  if (["paragraph", "quote", "formula", "tip", "warning"].includes(type)) {
    return { id, type, content: String(block.content || "").trim() };
  }

  if (type === "list") {
    return {
      id,
      type,
      heading: stripEmpty(block.heading),
      style: block.style === "ordered" ? "ordered" : "unordered",
      content: asArray(block.content),
    };
  }

  if (type === "image") {
    return {
      id,
      type,
      imageUrl: stripEmpty(block.imageUrl || block.url),
      alt: stripEmpty(block.alt || block.altText || block.caption),
      caption: stripEmpty(block.caption),
    };
  }

  if (type === "table") {
    const headers = asArray(block.headers);
    return {
      id,
      type,
      caption: stripEmpty(block.caption),
      headers,
      rows: Array.isArray(block.rows)
        ? block.rows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell || "")) : String(row || "").split("|").map((cell) => cell.trim()))
        : [],
    };
  }

  if (type === "faq") {
    return {
      id,
      type,
      items: Array.isArray(block.items) ? block.items.map((item) => ({
        question: String(item.question || "").trim(),
        answer: String(item.answer || "").trim(),
      })).filter((item) => item.question && item.answer) : [],
    };
  }

  if (type === "video") {
    return { id, type, url: stripEmpty(block.url), title: stripEmpty(block.title) };
  }

  if (type === "download") {
    return { id, type, title: stripEmpty(block.title), url: stripEmpty(block.url), description: stripEmpty(block.description) };
  }

  if (type === "related-course" || type === "related-test" || type === "internal-link" || type === "call-to-action") {
    return {
      id,
      type,
      content: stripEmpty(block.content),
      title: stripEmpty(block.title),
      description: stripEmpty(block.description),
      buttonLabel: stripEmpty(block.buttonLabel),
      buttonUrl: stripEmpty(block.buttonUrl || block.url),
      url: stripEmpty(block.url || block.buttonUrl),
    };
  }

  return { ...block, id, type };
};

const normalizeBlocks = (blocks) =>
  (Array.isArray(blocks) ? blocks : [])
    .map(normalizeBlock)
    .filter(Boolean);

const validateBlocks = (blocks) => {
  const errors = [];
  if (!blocks.length) errors.push("Add at least one content block.");

  blocks.forEach((block, index) => {
    const label = `Block ${index + 1}`;
    if (block.type === "heading" && !block.content) errors.push(`${label}: heading text is required.`);
    if (["paragraph", "quote", "formula", "tip", "warning"].includes(block.type) && !block.content) errors.push(`${label}: content is required.`);
    if (block.type === "list" && !block.content?.length) errors.push(`${label}: add at least one list item.`);
    if (block.type === "image") {
      if (!block.imageUrl) errors.push(`${label}: image URL is required.`);
      if (!block.alt) errors.push(`${label}: image alt text is required.`);
    }
    if (block.type === "table" && (!block.rows?.length || !block.headers?.length)) errors.push(`${label}: table needs headers and rows.`);
    if (block.type === "faq" && !block.items?.length) errors.push(`${label}: add at least one FAQ.`);
    if (["video", "download", "internal-link"].includes(block.type) && !block.url) errors.push(`${label}: URL is required.`);
  });

  return errors;
};

const validatePost = (payload, { publish = false } = {}) => {
  const errors = [];
  const blocks = normalizeBlocks(getBlocks(payload));

  if (!stripEmpty(payload.title)) errors.push("Title is required.");
  if (!normalizeSlug(payload.slug || payload.title)) errors.push("Slug is required.");
  if (payload.status === STATUS.SCHEDULED && !payload.scheduled_at) errors.push("Scheduled posts need a scheduled date.");
  if (payload.scheduled_at && Number.isNaN(new Date(payload.scheduled_at).getTime())) errors.push("Scheduled date is invalid.");

  if (publish || payload.status === STATUS.PUBLISHED || payload.status === STATUS.SCHEDULED) {
    if (!stripEmpty(payload.excerpt)) errors.push("Excerpt is required before publishing.");
    if (!stripEmpty(payload.seo_title || payload.title)) errors.push("SEO title is required before publishing.");
    if (!stripEmpty(payload.meta_description || payload.excerpt)) errors.push("Meta description is required before publishing.");
    if (!stripEmpty(payload.focus_keyword)) errors.push("Focus keyword is required before publishing.");
    if (!blocks.some((block) => block.type === "heading" && Number(block.level) === 2)) errors.push("Add at least one H2 heading before publishing.");
    errors.push(...validateBlocks(blocks));
  }

  return { errors, blocks };
};

const serializePost = (post, relatedPosts = []) => {
  if (!post) return null;
  const blocks = normalizeBlocks(post.content_blocks || []);
  const tags = asArray(post.tags);
  const secondaryKeywords = asArray(post.secondary_keywords);
  const exams = asArray(post.exams);
  const classLevels = asArray(post.class_levels);
  const subjects = asArray(post.subjects);
  const topicIds = asArray(post.topic_ids);
  const author = post.author ? {
    id: post.author.id,
    name: post.author.name,
    role: post.author.role,
    bio: post.author.bio,
    avatar: post.author.avatar_url,
    expertise: post.author.expertise || [],
    socialLinks: post.author.social_links || {},
  } : {
    name: "Dhriti Classes",
    role: "Dhriti Faculty",
    avatar: null,
  };

  return {
    ...post,
    content_blocks: blocks,
    tags,
    secondary_keywords: secondaryKeywords,
    exams,
    class_levels: classLevels,
    subjects,
    topic_ids: topicIds,
    cover_image: post.cover_image,
    cover_image_alt: post.cover_image_alt,
    published_at: post.published_at,
    read_time: post.read_time,
    seo_title: post.seo_title,
    meta_description: post.meta_description,
    focus_keyword: post.focus_keyword,
    canonical_url: post.canonical_url,
    og_title: post.og_title,
    og_description: post.og_description,
    og_image: post.og_image,
    author,
    author_name: author.name,
    author_avatar: author.avatar,
    relatedPosts,
  };
};

const publicWhere = () => ({
  status: STATUS.PUBLISHED,
  noindex: false,
  OR: [{ published_at: null }, { published_at: { lte: new Date() } }],
});

const createSnapshot = async (postId, body, userId) => {
  await prisma.blogRevision.create({
    data: {
      post_id: postId,
      snapshot: body,
      created_by: userId || null,
    },
  });
};

const ensureAuthor = async (body) => {
  if (body.author_id) return body.author_id;
  const authorName = stripEmpty(body.author_name) || "Dhriti Classes";
  const existing = await prisma.blogAuthor.findFirst({ where: { name: authorName } });
  if (existing) return existing.id;

  const created = await prisma.blogAuthor.create({
    data: {
      name: authorName,
      role: stripEmpty(body.author_role) || "Dhriti Faculty",
      avatar_url: stripEmpty(body.author_avatar),
      expertise: asArray(body.author_expertise),
    },
  });
  return created.id;
};

const buildPostData = async (body, existingPost = null) => {
  const { blocks } = validatePost(body);
  const normalizedSlug = normalizeSlug(body.slug || body.title);
  const status = body.status || existingPost?.status || STATUS.DRAFT;
  const authorId = await ensureAuthor(body);
  const readTime = stripEmpty(body.read_time) || estimateReadTime(blocks);
  const now = new Date();
  const exams = asArray(body.exams);
  const classLevels = asArray(body.class_levels);
  const subjects = asArray(body.subjects);
  const topicIds = asArray(body.topic_ids);

  return {
    slug: normalizedSlug,
    title: stripEmpty(body.title),
    excerpt: stripEmpty(body.excerpt),
    status,
    cover_image: stripEmpty(body.cover_image),
    cover_image_alt: stripEmpty(body.cover_image_alt || body.title),
    category: stripEmpty(body.category),
    exams,
    class_levels: classLevels,
    subjects,
    chapter: stripEmpty(body.chapter),
    author_id: authorId,
    topic_ids: topicIds,
    read_time: readTime,
    seo_title: stripEmpty(body.seo_title || body.title),
    meta_description: stripEmpty(body.meta_description || body.excerpt),
    focus_keyword: stripEmpty(body.focus_keyword),
    secondary_keywords: asArray(body.secondary_keywords),
    tags: asArray(body.tags),
    canonical_url: stripEmpty(body.canonical_url),
    noindex: Boolean(body.noindex),
    og_title: stripEmpty(body.og_title || body.seo_title || body.title),
    og_description: stripEmpty(body.og_description || body.meta_description || body.excerpt),
    og_image: stripEmpty(body.og_image || body.cover_image),
    content_blocks: blocks,
    scheduled_at: body.scheduled_at ? new Date(body.scheduled_at) : null,
    archived_at: status === STATUS.ARCHIVED ? (existingPost?.archived_at || now) : null,
    published_at: status === STATUS.PUBLISHED
      ? (body.published_at ? new Date(body.published_at) : existingPost?.published_at || now)
      : (body.published_at ? new Date(body.published_at) : existingPost?.published_at || null),
    updated_at: now,
  };
};

const getRelatedPosts = async (post) => {
  const relatedOr = [
    ...asArray(post.topic_ids).map((topicId) => ({ topic_ids: jsonArrayHas(topicId) })),
    ...asArray(post.exams).map((exam) => ({ exams: jsonArrayHas(exam) })),
    ...asArray(post.subjects).map((subject) => ({ subjects: jsonArrayHas(subject) })),
    post.chapter ? { chapter: post.chapter } : null,
  ].filter(Boolean);

  if (!relatedOr.length) return [];

  const where = {
    ...publicWhere(),
    id: { not: post.id },
    AND: [{ OR: relatedOr }],
  };

  const related = await prisma.blogPost.findMany({
    where,
    include: PUBLIC_POST_SELECT,
    orderBy: [{ published_at: "desc" }],
    take: 4,
  });

  return related.map((item) => serializePost(item));
};

router.get("/", async (req, res) => {
  const cacheKey = `blogs:public:${JSON.stringify(req.query)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { exam, subject, chapter, topic, q } = req.query;
    const topicRecord = topic ? await prisma.blogTopic.findUnique({ where: { slug: String(topic) }, select: { id: true } }) : null;
    const andFilters = taxonomyFilterGroups({ exam, subject, topicId: topicRecord?.id });
    if (q) {
      andFilters.push({
        OR: [
          { title: { contains: String(q) } },
          { excerpt: { contains: String(q) } },
          { focus_keyword: { contains: String(q) } },
          { chapter: { contains: String(q) } },
        ],
      });
    }

    const where = {
      ...publicWhere(),
      ...(chapter ? { chapter: String(chapter) } : {}),
      ...(andFilters.length ? { AND: andFilters } : {}),
    };

    const posts = await prisma.blogPost.findMany({
      where,
      include: PUBLIC_POST_SELECT,
      orderBy: [{ published_at: "desc" }, { updated_at: "desc" }],
    });

    const data = posts.map((post) => serializePost(post));
    cache.set(cacheKey, data, CACHE_TTL.BATCHES);
    res.json(data);
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).json({ error: "Failed to fetch blogs" });
  }
});

router.get("/topics", async (req, res) => {
  try {
    const topics = await prisma.blogTopic.findMany({
      orderBy: [{ sort_order: "asc" }, { title: "asc" }],
    });
    res.json(topics);
  } catch (err) {
    console.error("Error fetching blog topics:", err);
    res.status(500).json({ error: "Failed to fetch blog topics" });
  }
});

router.get("/authors", requireAuth, requireAdmin, async (req, res) => {
  try {
    const authors = await prisma.blogAuthor.findMany({ orderBy: { name: "asc" } });
    res.json(authors);
  } catch (err) {
    console.error("Error fetching blog authors:", err);
    res.status(500).json({ error: "Failed to fetch blog authors" });
  }
});

router.get("/sitemap-blogs.xml", async (req, res) => {
  try {
    const [posts, topics] = await Promise.all([
      prisma.blogPost.findMany({
        where: publicWhere(),
        select: { slug: true, updated_at: true },
        orderBy: { published_at: "desc" },
      }),
      prisma.blogTopic.findMany({
        select: { slug: true, updated_at: true },
        orderBy: { sort_order: "asc" },
      }),
    ]);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += `  <url>\n    <loc>${SITE_URL}/blogs</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;

    topics.forEach((topic) => {
      xml += `  <url>\n    <loc>${SITE_URL}/blogs/topic/${topic.slug}</loc>\n    <lastmod>${formatDateString(topic.updated_at || new Date())}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.75</priority>\n  </url>\n`;
    });

    posts.forEach((post) => {
      xml += `  <url>\n    <loc>${SITE_URL}/blogs/${post.slug}</loc>\n    <lastmod>${formatDateString(post.updated_at || new Date())}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    });

    xml += "</urlset>";
    res.set("Content-Type", "text/xml");
    res.send(xml);
  } catch (err) {
    console.error("Error generating blog sitemap:", err);
    res.status(500).send("Error generating blog sitemap");
  }
});

router.get("/manage", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, exam, subject, q } = req.query;
    const andFilters = taxonomyFilterGroups({ exam, subject });
    if (q) {
      andFilters.push({
        OR: [
          { title: { contains: String(q) } },
          { slug: { contains: String(q) } },
          { focus_keyword: { contains: String(q) } },
        ],
      });
    }
    const posts = await prisma.blogPost.findMany({
      where: {
        ...(status ? { status: String(status) } : {}),
        ...(andFilters.length ? { AND: andFilters } : {}),
      },
      include: PUBLIC_POST_SELECT,
      orderBy: [{ updated_at: "desc" }],
    });
    res.json(posts.map((post) => serializePost(post)));
  } catch (err) {
    console.error("Error fetching manageable blogs:", err);
    res.status(500).json({ error: "Failed to fetch blogs" });
  }
});

router.get("/manage/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await prisma.blogPost.findUnique({
      where: { id: req.params.id },
      include: PUBLIC_POST_SELECT,
    });
    if (!post) return res.status(404).json({ error: "Blog not found" });
    res.json(serializePost(post));
  } catch (err) {
    console.error("Error fetching blog by ID:", err);
    res.status(500).json({ error: "Failed to fetch blog" });
  }
});

router.get("/preview/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await prisma.blogPost.findUnique({
      where: { id: req.params.id },
      include: PUBLIC_POST_SELECT,
    });
    if (!post) return res.status(404).json({ error: "Blog not found" });
    res.json(serializePost(post));
  } catch (err) {
    console.error("Error fetching blog preview:", err);
    res.status(500).json({ error: "Failed to fetch preview" });
  }
});

router.post("/upload-image", requireAuth, requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No image file provided" });

    // Convert to WebP for better compression and modern browser support
    const webpBuffer = await sharp(file.buffer)
      .webp({ quality: 85 })
      .toBuffer();

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const fileName = `blog-${uniqueSuffix}.webp`;
    const remotePath = `${FTP_BASE_PATH}/blogs/${fileName}`;
    const publicUrl = `${BASE_URL}/blogs/${fileName}`;

    await uploadFile(webpBuffer, remotePath);

    const asset = await prisma.blogAsset.create({
      data: {
        post_id: stripEmpty(req.body.post_id),
        url: publicUrl,
        alt_text: stripEmpty(req.body.alt_text),
        caption: stripEmpty(req.body.caption),
        mime_type: "image/webp",
        size_bytes: BigInt(webpBuffer.length),
        metadata: { originalName: file.originalname, originalMime: file.mimetype },
      },
    });

    res.json({ success: true, url: publicUrl, asset: { ...asset, size_bytes: Number(asset.size_bytes || 0) } });
  } catch (err) {
    console.error("Error uploading blog image:", err);
    res.status(500).json({ error: "Failed to upload image", details: err.message });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { errors } = validatePost(req.body, { publish: req.body.status === STATUS.PUBLISHED });
    if (errors.length) return res.status(400).json({ error: "Blog validation failed", details: errors });

    const slug = normalizeSlug(req.body.slug || req.body.title);
    const existing = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
    if (existing) return res.status(409).json({ error: "A blog with this slug already exists." });

    const data = await buildPostData(req.body);
    const post = await prisma.blogPost.create({
      data,
      include: PUBLIC_POST_SELECT,
    });

    await createSnapshot(post.id, serializePost(post), req.user?.id);
    cache.invalidatePattern("blogs:");

    // Auto-notify search engines when a new blog is published
    if (post.status === STATUS.PUBLISHED) {
      pingIndexNow([`${SITE_URL}/blogs/${post.slug}`, `${SITE_URL}/blogs`]).catch(() => {});
      prerenderAndUploadBlog(serializePost(post)).catch(() => {});
      prerenderAndUploadBlogListing().catch(() => {});
      prerenderAndUploadBlogSitemap().catch(() => {});
    }

    res.status(201).json(serializePost(post));
  } catch (err) {
    console.error("Error creating blog:", err);
    res.status(500).json({ error: "Failed to create blog", details: err.message });
  }
});

router.post("/:id/autosave", requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: "Blog not found" });

    const data = await buildPostData({ ...post, ...req.body, status: req.body.status || post.status }, post);
    const updated = await prisma.blogPost.update({
      where: { id: req.params.id },
      data,
      include: PUBLIC_POST_SELECT,
    });

    await createSnapshot(updated.id, serializePost(updated), req.user?.id);
    cache.invalidatePattern("blogs:");
    
    if (updated.status === STATUS.PUBLISHED) {
      prerenderAndUploadBlog(serializePost(updated)).catch(() => {});
      prerenderAndUploadBlogListing().catch(() => {});
      prerenderAndUploadBlogSitemap().catch(() => {});
    }
    
    res.json(serializePost(updated));
  } catch (err) {
    console.error("Error autosaving blog:", err);
    res.status(500).json({ error: "Failed to autosave blog" });
  }
});

router.post("/:id/duplicate", requireAuth, requireAdmin, async (req, res) => {
  try {
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: "Blog not found" });

    const baseSlug = normalizeSlug(`${post.slug}-copy`);
    let slug = baseSlug;
    let suffix = 2;
    while (await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const duplicate = await prisma.blogPost.create({
      data: {
        ...post,
        id: undefined,
        slug,
        title: `${post.title} Copy`,
        status: STATUS.DRAFT,
        published_at: null,
        scheduled_at: null,
        archived_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      include: PUBLIC_POST_SELECT,
    });

    cache.invalidatePattern("blogs:");
    res.status(201).json(serializePost(duplicate));
  } catch (err) {
    console.error("Error duplicating blog:", err);
    res.status(500).json({ error: "Failed to duplicate blog" });
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const existingPost = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existingPost) return res.status(404).json({ error: "Blog not found" });

    const { errors } = validatePost(req.body, { publish: req.body.status === STATUS.PUBLISHED });
    if (errors.length) return res.status(400).json({ error: "Blog validation failed", details: errors });

    const slug = normalizeSlug(req.body.slug || req.body.title);
    const slugOwner = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
    if (slugOwner && slugOwner.id !== req.params.id) return res.status(409).json({ error: "A blog with this slug already exists." });

    const data = await buildPostData(req.body, existingPost);
    const updated = await prisma.blogPost.update({
      where: { id: req.params.id },
      data,
      include: PUBLIC_POST_SELECT,
    });

    await createSnapshot(updated.id, serializePost(updated), req.user?.id);
    cache.invalidatePattern("blogs:");

    // Auto-notify search engines when a blog is published/updated
    if (updated.status === STATUS.PUBLISHED) {
      pingIndexNow([`${SITE_URL}/blogs/${updated.slug}`, `${SITE_URL}/blogs`]).catch(() => {});
      prerenderAndUploadBlog(serializePost(updated)).catch(() => {});
      prerenderAndUploadBlogListing().catch(() => {});
      prerenderAndUploadBlogSitemap().catch(() => {});
    } else if (existingPost.status === STATUS.PUBLISHED && updated.status !== STATUS.PUBLISHED) {
      deletePrerenderedBlog(updated.slug).catch(() => {});
      prerenderAndUploadBlogListing().catch(() => {});
      prerenderAndUploadBlogSitemap().catch(() => {});
    }

    res.json(serializePost(updated));
  } catch (err) {
    console.error("Error updating blog:", err);
    res.status(500).json({ error: "Failed to update blog", details: err.message });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const updated = await prisma.blogPost.update({
      where: { id: req.params.id },
      data: { status: STATUS.ARCHIVED, archived_at: new Date(), updated_at: new Date() },
    });
    cache.invalidatePattern("blogs:");
    deletePrerenderedBlog(updated.slug).catch(() => {});
    prerenderAndUploadBlogListing().catch(() => {});
    prerenderAndUploadBlogSitemap().catch(() => {});
    res.json({ message: "Blog archived successfully" });
  } catch (err) {
    console.error("Error archiving blog:", err);
    res.status(500).json({ error: "Failed to archive blog" });
  }
});

router.get("/topic/:slug", async (req, res) => {
  try {
    const topic = await prisma.blogTopic.findUnique({ where: { slug: req.params.slug } });
    if (!topic) return res.status(404).json({ error: "Topic not found" });

    const posts = await prisma.blogPost.findMany({
      where: {
        ...publicWhere(),
        AND: [{ topic_ids: jsonArrayHas(topic.id) }],
      },
      include: PUBLIC_POST_SELECT,
      orderBy: [{ published_at: "desc" }],
    });

    res.json({ topic, posts: posts.map((post) => serializePost(post)) });
  } catch (err) {
    console.error("Error fetching topic page:", err);
    res.status(500).json({ error: "Failed to fetch topic" });
  }
});

router.get("/:slug", async (req, res) => {
  const cacheKey = `blogs:slug:${req.params.slug}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const post = await prisma.blogPost.findFirst({
      where: { ...publicWhere(), slug: req.params.slug },
      include: PUBLIC_POST_SELECT,
    });

    if (!post) return res.status(404).json({ error: "Blog not found" });
    const relatedPosts = await getRelatedPosts(post);
    const data = serializePost(post, relatedPosts);
    cache.set(cacheKey, data, CACHE_TTL.BATCHES);
    res.json(data);
  } catch (err) {
    console.error("Error fetching blog:", err);
    res.status(500).json({ error: "Failed to fetch blog" });
  }
});

module.exports = router;
