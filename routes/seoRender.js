/**
 * SEO Dynamic Rendering Routes
 * 
 * These routes serve complete HTML pages to search engine crawlers.
 * Regular users get the React SPA; crawlers get pre-rendered HTML with
 * all meta tags, structured data, and visible content.
 * 
 * Mounted at /render in server.js
 */

const express = require("express");
const router = express.Router();
const prisma = require("../services/prisma");

const SITE_URL = (process.env.PUBLIC_SITE_URL || "https://dhriticlasses.com").replace(/\/$/, "");
const SITE_NAME = "Dhriti Classes";
const DEFAULT_OG_IMAGE = `${SITE_URL}/logo.png`;

// ─── Helpers ─────────────────────────────────────────────────────────

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stripHtml = (value = "") => String(value).replace(/<[^>]+>/g, "").trim();

const slugifyHeading = (value, index) =>
  `${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "") || "section"}-${index}`;

// ─── Content Block Renderer ──────────────────────────────────────────

const renderBlocks = (blocks = []) =>
  blocks
    .map((block, index) => {
      switch (block?.type) {
        case "heading": {
          const level = Math.min(4, Math.max(2, Number(block.level || 2)));
          const headingId = slugifyHeading(block.content || "", index);
          return `<h${level} id="${headingId}">${escapeHtml(block.content || "")}</h${level}>`;
        }
        case "paragraph":
          return `<p>${escapeHtml(block.content || "")}</p>`;
        case "list": {
          const tag = block.style === "ordered" ? "ol" : "ul";
          const items = Array.isArray(block.content) ? block.content : [];
          return `${block.heading ? `<h3>${escapeHtml(block.heading)}</h3>` : ""}<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
        }
        case "image":
          return `<figure><img src="${escapeHtml(block.imageUrl || "")}" alt="${escapeHtml(block.alt || block.caption || "")}" loading="lazy">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
        case "table":
          return `<table>${block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : ""}<thead><tr>${(block.headers || []).map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${(block.rows || []).map((row) => {
            const cells = Array.isArray(row) ? row : String(row || "").split("|").map((c) => c.trim());
            return `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`;
          }).join("")}</tbody></table>`;
        case "faq":
          return `<section class="faq">${(block.items || []).filter((i) => i?.question && i?.answer).map((i) => `<details open><summary>${escapeHtml(i.question)}</summary><p>${escapeHtml(i.answer)}</p></details>`).join("")}</section>`;
        case "formula":
          return `<pre><code>${escapeHtml(block.content || "")}</code></pre>`;
        case "quote":
          return `<blockquote>${escapeHtml(block.content || "")}</blockquote>`;
        case "tip":
        case "warning":
          return `<aside class="${block.type}">${escapeHtml(block.content || "")}</aside>`;
        case "video":
          return `<p><a href="${escapeHtml(block.url || "")}">${escapeHtml(block.title || "Watch video")}</a></p>`;
        case "call-to-action":
        case "internal-link":
        case "related-course":
          return `<aside><h3>${escapeHtml(block.title || block.content || "Recommended")}</h3>${block.description ? `<p>${escapeHtml(block.description)}</p>` : ""}<a href="${escapeHtml(block.buttonUrl || block.url || "#")}">${escapeHtml(block.buttonLabel || "Learn More")}</a></aside>`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");

// ─── Schema Generators ───────────────────────────────────────────────

const organizationSchema = () => ({
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "EducationalOrganization"],
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: DEFAULT_OG_IMAGE,
  image: DEFAULT_OG_IMAGE,
  email: "enquiry@dhriticlasses.com",
  telephone: "+917017868773",
  address: {
    "@type": "PostalAddress",
    streetAddress: "3rd Floor, Lalit Grace Plaza, Near V-Mart",
    addressLocality: "Mathura",
    addressRegion: "Uttar Pradesh",
    postalCode: "281003",
    addressCountry: "IN",
  },
  geo: { "@type": "GeoCoordinates", latitude: 27.4928, longitude: 77.6732 },
  openingHours: "Mo-Sa 07:00-20:00",
  priceRange: "₹₹",
  areaServed: { "@type": "City", name: "Mathura" },
  sameAs: [
    "https://www.facebook.com/p/Dhriti-Classes-61572213385334/",
    "https://www.instagram.com/dhriticlassess/",
    "https://www.youtube.com/@DhritiClassesrs",
    "https://www.linkedin.com/company/dhriticlasses/",
    "https://x.com/Dhriticlasses",
  ],
});

const websiteSchema = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: SITE_URL,
  name: SITE_NAME,
  publisher: { "@id": `${SITE_URL}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/blogs?search={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
});

const siteNavSchema = () => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: [
    { "@type": "SiteNavigationElement", position: 1, name: "Courses", url: `${SITE_URL}/courses` },
    { "@type": "SiteNavigationElement", position: 2, name: "About", url: `${SITE_URL}/about` },
    { "@type": "SiteNavigationElement", position: 3, name: "Contact", url: `${SITE_URL}/contact` },
    { "@type": "SiteNavigationElement", position: 4, name: "Login", url: `${SITE_URL}/login` },
    { "@type": "SiteNavigationElement", position: 5, name: "Blogs", url: `${SITE_URL}/blogs` },
    { "@type": "SiteNavigationElement", position: 6, name: "Free Resources", url: `${SITE_URL}/resources` },
  ],
});

const breadcrumbSchema = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: item.name,
    item: item.path === "/" ? SITE_URL : `${SITE_URL}${item.path}`,
  })),
});

const blogPostingSchema = (post) => ({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: post.seo_title || post.title,
  description: post.meta_description || post.excerpt || "",
  image: post.cover_image || DEFAULT_OG_IMAGE,
  url: `${SITE_URL}/blogs/${post.slug}`,
  datePublished: post.published_at ? new Date(post.published_at).toISOString() : undefined,
  dateModified: post.updated_at ? new Date(post.updated_at).toISOString() : undefined,
  author: {
    "@type": "Person",
    name: post.author?.name || "Dhriti Classes",
  },
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    logo: { "@type": "ImageObject", url: DEFAULT_OG_IMAGE },
  },
  mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blogs/${post.slug}` },
  keywords: [post.focus_keyword, ...(post.secondary_keywords || [])].filter(Boolean).join(", "),
});

const faqSchemaFromBlocks = (blocks = []) => {
  const items = blocks
    .filter((b) => b?.type === "faq")
    .flatMap((b) => b.items || [])
    .filter((i) => i?.question && i?.answer);
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
};

const faqSchema = (faqs) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  })),
});

// ─── Navigation HTML (for internal linking) ──────────────────────────

const navHtml = `
<nav style="background:#1e293b;padding:12px 24px;margin-bottom:24px">
  <a href="${SITE_URL}" style="color:#fff;margin-right:16px;text-decoration:none;font-weight:bold">${SITE_NAME}</a>
  <a href="${SITE_URL}/courses" style="color:#94a3b8;margin-right:12px;text-decoration:none">Courses</a>
  <a href="${SITE_URL}/resources" style="color:#94a3b8;margin-right:12px;text-decoration:none">Free Resources</a>
  <a href="${SITE_URL}/about" style="color:#94a3b8;margin-right:12px;text-decoration:none">About</a>
  <a href="${SITE_URL}/contact" style="color:#94a3b8;margin-right:12px;text-decoration:none">Contact</a>
  <a href="${SITE_URL}/results" style="color:#94a3b8;margin-right:12px;text-decoration:none">Results</a>
  <a href="${SITE_URL}/blogs" style="color:#94a3b8;margin-right:12px;text-decoration:none">Blogs</a>
  <a href="${SITE_URL}/login" style="color:#94a3b8;text-decoration:none">Login</a>
</nav>`;

// ─── Page Builder ────────────────────────────────────────────────────

const buildPage = ({ title, description, canonical, ogImage, schemas = [], body }) => {
  const schemasHtml = schemas
    .filter(Boolean)
    .map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical || SITE_URL)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical || SITE_URL)}">
  <meta property="og:image" content="${escapeHtml(ogImage || DEFAULT_OG_IMAGE)}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage || DEFAULT_OG_IMAGE)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=Outfit:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    body{font-family:'Inter',sans-serif;margin:0;padding:0;color:#1e293b;line-height:1.7;background:#f8fafc}
    article{max-width:800px;margin:0 auto;padding:24px}
    h1{font-family:'Outfit',sans-serif;font-size:2rem;margin:0 0 8px}
    h2{font-size:1.5rem;margin:32px 0 12px}
    h3{font-size:1.25rem;margin:24px 0 8px}
    p{margin:0 0 16px}
    img{max-width:100%;height:auto;border-radius:8px}
    a{color:#4f46e5}
    table{width:100%;border-collapse:collapse;margin:16px 0}
    th,td{border:1px solid #e2e8f0;padding:8px 12px;text-align:left}
    th{background:#f1f5f9;font-weight:600}
    blockquote{border-left:4px solid #6366f1;padding:12px 16px;margin:16px 0;background:#eef2ff}
    details{margin:8px 0;padding:12px;background:#f1f5f9;border-radius:8px}
    summary{font-weight:600;cursor:pointer}
    aside.tip{padding:12px 16px;background:#ecfdf5;border-left:4px solid #10b981;margin:16px 0}
    aside.warning{padding:12px 16px;background:#fef2f2;border-left:4px solid #ef4444;margin:16px 0}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:8px 0}
    .card h3{margin:0 0 4px}
    .card p{margin:0;color:#64748b;font-size:0.9rem}
  </style>
  ${schemasHtml}
</head>
<body>
${navHtml}
${body}
</body>
</html>`;
};

// ─── Public blog query filter ────────────────────────────────────────

const publicWhere = () => ({
  status: "PUBLISHED",
  noindex: false,
  OR: [{ published_at: null }, { published_at: { lte: new Date() } }],
});

// ═════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════

// ─── Homepage ────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const homeFaqs = [
      { question: "What is Dhriti Classes?", answer: "A premier Mathura coaching institute for JEE Main, Advanced, NEET, and foundation classes (8th-12th)." },
      { question: "Where is Dhriti Classes located?", answer: "Two Mathura branches: Head Office at Lalit Grace Plaza (Near V-Mart) and Second Branch at Techman City." },
      { question: "Does Dhriti Classes offer JEE coaching?", answer: "Yes, comprehensive JEE Main & Advanced prep with IIT faculty, practice papers, and test series." },
      { question: "Does Dhriti Classes offer NEET coaching?", answer: "Yes, dedicated NEET-UG preparation led by expert PCB faculty with structured mock tests." },
      { question: "How can I enroll at Dhriti Classes?", answer: "Visit our Mathura campuses, call us at +91 70178 68773, or fill the online contact form." },
    ];

    const body = `
<article>
  <h1>Dhriti Classes — Best JEE & NEET Coaching in Mathura</h1>
  <p>Dhriti Classes is a leading coaching institute in Mathura offering expert preparation for <strong>JEE Main</strong>, <strong>JEE Advanced</strong>, <strong>NEET</strong>, and foundation programs for classes 8th to 12th. With experienced IIT faculty, daily practice papers, all-India test series, and personalized mentorship, we help students achieve top ranks.</p>
  <h2>Why Choose Dhriti Classes?</h2>
  <ul>
    <li>Expert faculty with IIT & medical college backgrounds</li>
    <li>Structured coaching for JEE and NEET in Mathura</li>
    <li>Daily Practice Papers (DPP) and weekly tests</li>
    <li>All-India Test Series for competitive benchmarking</li>
    <li>Foundation batches for Class 8th, 9th, and 10th</li>
    <li>Free study resources and video lectures</li>
  </ul>
  <h2>Our Branches</h2>
  <p><strong>Head Office:</strong> 3rd Floor, Lalit Grace Plaza, Near V-Mart, Mathura – 281003</p>
  <p><strong>Second Branch:</strong> Garg Brothers Complex, Techman City Main Road, Mathura – 281006</p>
  <p>Contact: <a href="tel:+917017868773">+91 70178 68773</a> | <a href="mailto:enquiry@dhriticlasses.com">enquiry@dhriticlasses.com</a></p>
  <h2>Frequently Asked Questions</h2>
  ${homeFaqs.map((f) => `<details open><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join("\n  ")}
  <p><a href="${SITE_URL}/courses">View Our Courses</a> | <a href="${SITE_URL}/contact">Contact Us</a> | <a href="${SITE_URL}/resources">Free Resources</a></p>
</article>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title: "Dhriti Classes | Best JEE & NEET Coaching in Mathura",
        description: "Dhriti Classes is a leading coaching institute in Mathura for JEE Main, JEE Advanced, NEET, and foundation preparation with expert faculty, tests, and mentorship.",
        canonical: SITE_URL,
        schemas: [
          organizationSchema(),
          websiteSchema(),
          siteNavSchema(),
          breadcrumbSchema([{ name: "Home", path: "/" }]),
          faqSchema(homeFaqs),
        ],
        body,
      })
    );
  } catch (err) {
    console.error("[SEO Render] Homepage error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ─── Courses Listing ─────────────────────────────────────────────────

router.get("/courses", async (req, res) => {
  try {
    const courses = await prisma.batches.findMany({
      where: { is_active: true },
      include: { stream: true },
      orderBy: { created_at: "desc" },
    });

    const courseFaqs = [
      { question: "Which courses does Dhriti Classes offer?", answer: "JEE Main & Advanced prep, NEET UG coaching, and junior Foundation programs (classes 8th-12th)." },
      { question: "Is there a foundation batch for Class 9 and 10?", answer: "Yes, dedicated batches for classes 9th & 10th to build early concepts for JEE and NEET." },
      { question: "What is the duration of the JEE coaching program?", answer: "We offer 1-year and 2-year programs depending on your class level and target exam year." },
      { question: "Do you offer NEET coaching in Mathura?", answer: "Yes, led by experienced Biology, Physics, and Chemistry subject specialists." },
      { question: "How are the batches structured at Dhriti Classes?", answer: "Structured by target exam, class, and year. We keep batch sizes small for personalized attention." },
    ];

    const courseCards = courses
      .map((c) => `<div class="card"><h3><a href="${SITE_URL}/courses/${escapeHtml(c.id)}">${escapeHtml(c.title)}</a></h3><p>${escapeHtml(c.description || "")}</p><p>Stream: ${escapeHtml(c.stream?.title || "")}</p></div>`)
      .join("\n");

    const itemListSchema = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: courses.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.title,
        url: `${SITE_URL}/courses/${c.id}`,
      })),
    };

    const body = `
<article>
  <h1>Our Courses — JEE, NEET & Foundation Batches</h1>
  <p>Explore coaching programs at Dhriti Classes, Mathura. We offer expert-led courses for JEE Main, JEE Advanced, NEET UG, and foundation students from Class 8th to 12th.</p>
  ${courseCards}
  <h2>Course FAQs</h2>
  ${courseFaqs.map((f) => `<details open><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join("\n  ")}
</article>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title: "Courses | JEE, NEET & Foundation Coaching in Mathura - Dhriti Classes",
        description: "Explore Dhriti Classes courses for JEE Main, JEE Advanced, NEET, and foundation students with structured batches and expert guidance in Mathura.",
        canonical: `${SITE_URL}/courses`,
        schemas: [
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Courses", path: "/courses" }]),
          itemListSchema,
          faqSchema(courseFaqs),
        ],
        body,
      })
    );
  } catch (err) {
    console.error("[SEO Render] Courses error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ─── Individual Course ───────────────────────────────────────────────

router.get("/courses/:courseId", async (req, res) => {
  try {
    const course = await prisma.batches.findFirst({
      where: { id: req.params.courseId },
      include: { stream: true },
    });

    if (!course) return res.status(404).send("Course not found");

    const courseSchema = {
      "@context": "https://schema.org",
      "@type": "Course",
      name: course.title,
      description: course.description || `${course.title} coaching at Dhriti Classes, Mathura`,
      provider: { "@type": "EducationalOrganization", name: SITE_NAME, url: SITE_URL },
      hasCourseInstance: {
        "@type": "CourseInstance",
        courseMode: "Offline",
        startDate: course.batch_date ? new Date(course.batch_date).toISOString().split("T")[0] : undefined,
        locationCreated: { "@type": "Place", name: "Dhriti Classes, Mathura" },
      },
    };

    const features = Array.isArray(course.features) ? course.features : [];
    const faculty = Array.isArray(course.faculty) ? course.faculty : [];

    const body = `
<article>
  <h1>${escapeHtml(course.title)} — Dhriti Classes</h1>
  <p>${escapeHtml(course.description || "")}</p>
  <p><strong>Stream:</strong> ${escapeHtml(course.stream?.title || "")}</p>
  ${course.duration ? `<p><strong>Duration:</strong> ${escapeHtml(course.duration)}</p>` : ""}
  ${course.price ? `<p><strong>Fee:</strong> ₹${escapeHtml(course.price)}</p>` : ""}
  ${features.length ? `<h2>Course Highlights</h2><ul>${features.map((f) => `<li>${escapeHtml(typeof f === "string" ? f : f.title || "")}</li>`).join("")}</ul>` : ""}
  ${faculty.length ? `<h2>Faculty</h2><ul>${faculty.map((f) => `<li>${escapeHtml(typeof f === "string" ? f : f.name || "")}</li>`).join("")}</ul>` : ""}
  <p><a href="${SITE_URL}/contact">Enquire Now</a> | <a href="${SITE_URL}/courses">All Courses</a></p>
</article>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title: `${course.title} Batch | Dhriti Classes`,
        description: course.description ? course.description.slice(0, 160) : `Enroll in ${course.title} batch at Dhriti Classes, Mathura.`,
        canonical: `${SITE_URL}/courses/${course.id}`,
        schemas: [
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Courses", path: "/courses" }, { name: course.title, path: `/courses/${course.id}` }]),
          courseSchema,
        ],
        body,
      })
    );
  } catch (err) {
    console.error("[SEO Render] Course detail error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ─── Blog Listing ────────────────────────────────────────────────────

router.get("/blogs", async (req, res) => {
  try {
    const posts = await prisma.blogPost.findMany({
      where: publicWhere(),
      include: { author: true },
      orderBy: { published_at: "desc" },
      take: 50,
    });

    const postCards = posts
      .map((p) => `<div class="card"><h3><a href="${SITE_URL}/blogs/${escapeHtml(p.slug)}">${escapeHtml(p.seo_title || p.title)}</a></h3><p>${escapeHtml(p.excerpt || "")}</p><p>${p.published_at ? new Date(p.published_at).toLocaleDateString("en-IN") : ""} · ${escapeHtml(p.read_time || "")}</p></div>`)
      .join("\n");

    const body = `
<article>
  <h1>JEE & NEET Preparation Blog — Dhriti Classes</h1>
  <p>Expert articles, study tips, exam strategies, and chapter explanations for JEE Main, JEE Advanced, and NEET aspirants by Dhriti Classes, Mathura.</p>
  ${postCards}
</article>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title: "JEE & NEET Preparation Blog | Dhriti Classes",
        description: "Read expert articles, study tips, exam strategies, and chapter explanations for JEE and NEET preparation from Dhriti Classes, Mathura.",
        canonical: `${SITE_URL}/blogs`,
        schemas: [
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Blogs", path: "/blogs" }]),
        ],
        body,
      })
    );
  } catch (err) {
    console.error("[SEO Render] Blog listing error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ─── Blog Topic ──────────────────────────────────────────────────────

router.get("/blogs/topic/:slug", async (req, res) => {
  try {
    const topic = await prisma.blogTopic.findUnique({ where: { slug: req.params.slug } });
    if (!topic) return res.status(404).send("Topic not found");

    const posts = await prisma.blogPost.findMany({
      where: { ...publicWhere(), topic_ids: { path: "$", array_contains: topic.id } },
      include: { author: true },
      orderBy: { published_at: "desc" },
      take: 50,
    });

    const postCards = posts
      .map((p) => `<div class="card"><h3><a href="${SITE_URL}/blogs/${escapeHtml(p.slug)}">${escapeHtml(p.seo_title || p.title)}</a></h3><p>${escapeHtml(p.excerpt || "")}</p></div>`)
      .join("\n");

    const body = `
<article>
  <h1>${escapeHtml(topic.title)} — Dhriti Classes Blog</h1>
  <p>${escapeHtml(topic.description || `Articles about ${topic.title} for JEE and NEET preparation.`)}</p>
  ${postCards}
</article>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title: `${topic.title} | Dhriti Classes Blog`,
        description: topic.description || `Articles about ${topic.title} for JEE and NEET preparation from Dhriti Classes.`,
        canonical: `${SITE_URL}/blogs/topic/${topic.slug}`,
        schemas: [
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Blogs", path: "/blogs" }, { name: topic.title, path: `/blogs/topic/${topic.slug}` }]),
        ],
        body,
      })
    );
  } catch (err) {
    console.error("[SEO Render] Blog topic error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ─── Individual Blog Post ────────────────────────────────────────────

router.get("/blogs/:slug", async (req, res) => {
  try {
    const post = await prisma.blogPost.findFirst({
      where: { ...publicWhere(), slug: req.params.slug },
      include: { author: true },
    });

    if (!post) return res.status(404).send("Blog not found");

    const blocks = post.content_blocks || [];
    const faqSch = faqSchemaFromBlocks(blocks);

    const body = `
<article>
  <h1>${escapeHtml(post.seo_title || post.title)}</h1>
  <p><em>By ${escapeHtml(post.author?.name || "Dhriti Classes")} · ${post.published_at ? new Date(post.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : ""} · ${escapeHtml(post.read_time || "")}</em></p>
  ${post.cover_image ? `<figure><img src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(post.cover_image_alt || post.title)}"></figure>` : ""}
  ${renderBlocks(blocks)}
  <p><a href="${SITE_URL}/blogs">← Back to all articles</a></p>
</article>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      buildPage({
        title: post.seo_title || post.title,
        description: post.meta_description || post.excerpt || "",
        canonical: post.canonical_url || `${SITE_URL}/blogs/${post.slug}`,
        ogImage: post.og_image || post.cover_image || DEFAULT_OG_IMAGE,
        schemas: [
          breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Blogs", path: "/blogs" }, { name: post.title, path: `/blogs/${post.slug}` }]),
          blogPostingSchema(post),
          faqSch,
        ],
        body,
      })
    );
  } catch (err) {
    console.error("[SEO Render] Blog post error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ─── About ───────────────────────────────────────────────────────────

router.get("/about", async (req, res) => {
  const body = `
<article>
  <h1>About Dhriti Classes — JEE & NEET Coaching Institute in Mathura</h1>
  <p>Dhriti Classes is a premier coaching institute established in Mathura dedicated to providing quality education for competitive exams like JEE Main, JEE Advanced, and NEET UG. Our mission is to nurture students with strong conceptual foundations and exam-ready skills.</p>
  <h2>Our Mission</h2>
  <p>To provide accessible, high-quality coaching for JEE and NEET aspirants in Mathura and help every student realize their potential for top engineering and medical colleges in India.</p>
  <h2>What Sets Us Apart</h2>
  <ul>
    <li>Experienced IIT and medical college faculty</li>
    <li>Small batch sizes for personalized attention</li>
    <li>Comprehensive study material and daily practice papers</li>
    <li>Regular parent-teacher meetings and progress tracking</li>
    <li>Smart classrooms with modern teaching aids</li>
  </ul>
  <p><a href="${SITE_URL}/courses">Explore Our Courses</a> | <a href="${SITE_URL}/contact">Get in Touch</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "About Dhriti Classes | JEE & NEET Coaching Institute in Mathura",
      description: "Learn about Dhriti Classes, a premier coaching institute in Mathura for JEE and NEET preparation with experienced faculty and proven results.",
      canonical: `${SITE_URL}/about`,
      schemas: [
        organizationSchema(),
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "About", path: "/about" }]),
      ],
      body,
    })
  );
});

// ─── Contact ─────────────────────────────────────────────────────────

router.get("/contact", async (req, res) => {
  const contactFaqs = [
    { question: "How can I contact you for admission counselling?", answer: "Call +91 70178 68773, email enquiry@dhriticlasses.com, or submit the form on this page." },
    { question: "Where is the Mathura campus located?", answer: "3rd Floor, Lalit Grace Plaza, BSA Road (near New Bus Stand), Mathura, UP 281003." },
    { question: "Can I send enquiries for JEE and NEET here?", answer: "Yes, you can submit quick enquiries for JEE, NEET, and Foundation batches directly." },
    { question: "Do you offer both JEE and NEET coaching?", answer: "Yes, we provide targeted prep for JEE Main, Advanced, and NEET UG exams." },
    { question: "How do I visit the campus?", answer: "Use the Google Map section on this page or follow directions to Lalit Grace Plaza on BSA Road." },
  ];

  const body = `
<article>
  <h1>Contact Dhriti Classes — JEE & NEET Coaching in Mathura</h1>
  <p>Get in touch with us for admissions, course inquiries, or any other questions about JEE and NEET coaching at Dhriti Classes, Mathura.</p>
  <h2>Contact Details</h2>
  <p><strong>Phone:</strong> <a href="tel:+917017868773">+91 70178 68773</a></p>
  <p><strong>Email:</strong> <a href="mailto:enquiry@dhriticlasses.com">enquiry@dhriticlasses.com</a></p>
  <h2>Our Locations</h2>
  <p><strong>Head Office:</strong> 3rd Floor, Lalit Grace Plaza, Near V-Mart, Mathura – 281003</p>
  <p><strong>Second Branch:</strong> Garg Brothers Complex, Techman City Main Road, Mathura – 281006</p>
  <h2>Frequently Asked Questions</h2>
  ${contactFaqs.map((f) => `<details open><summary>${escapeHtml(f.question)}</summary><p>${escapeHtml(f.answer)}</p></details>`).join("\n  ")}
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Contact Dhriti Classes | JEE & NEET Coaching Mathura",
      description: "Contact Dhriti Classes for admissions and inquiries about JEE and NEET coaching in Mathura. Call +91 70178 68773 or visit our campus.",
      canonical: `${SITE_URL}/contact`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }]),
        faqSchema(contactFaqs),
      ],
      body,
    })
  );
});

// ─── Resources ───────────────────────────────────────────────────────

router.get("/resources", async (req, res) => {
  const body = `
<article>
  <h1>Free Study Resources — JEE & NEET Material | Dhriti Classes</h1>
  <p>Access free JEE and NEET study material, video lectures, practice tests, and PDF notes from Dhriti Classes, Mathura. Our free resources are designed to help students prepare effectively for competitive exams.</p>
  <h2>Available Resources</h2>
  <ul>
    <li>Video Lectures — Free YouTube video lectures on Physics, Chemistry, Maths, and Biology</li>
    <li>PDF Notes — Downloadable chapter-wise notes and formula sheets</li>
    <li>Practice Tests — Free mock tests and previous year paper analysis</li>
  </ul>
  <p><a href="${SITE_URL}/courses">View Full Course Programs</a> | <a href="${SITE_URL}/contact">Contact for Admission</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Free Study Resources | JEE & NEET Material | Dhriti Classes",
      description: "Access free JEE & NEET study material, video lectures, practice tests, and PDF notes from Dhriti Classes Mathura.",
      canonical: `${SITE_URL}/resources`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Free Resources", path: "/resources" }]),
      ],
      body,
    })
  );
});

// ─── Results ─────────────────────────────────────────────────────────

router.get("/results", async (req, res) => {
  const body = `
<article>
  <h1>Our Results — JEE & NEET Toppers at Dhriti Classes Mathura</h1>
  <p>See the results and toppers of Dhriti Classes. Our students consistently achieve top ranks in JEE Main, JEE Advanced, and NEET examinations. The dedication of our faculty and the hard work of our students produce outstanding results every year.</p>
  <p><a href="${SITE_URL}/courses">Join Our Courses</a> | <a href="${SITE_URL}/contact">Contact Us</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Our Results | JEE & NEET Toppers at Dhriti Classes Mathura",
      description: "See the results and toppers of Dhriti Classes. Our students consistently achieve top ranks in JEE Main, JEE Advanced, and NEET examinations.",
      canonical: `${SITE_URL}/results`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Results", path: "/results" }]),
      ],
      body,
    })
  );
});

// ─── Gallery ─────────────────────────────────────────────────────────

router.get("/gallery", async (req, res) => {
  const body = `
<article>
  <h1>Campus Gallery — Dhriti Classes Mathura</h1>
  <p>Take a virtual tour of Dhriti Classes' state-of-the-art campus, smart classrooms, and study environment in Mathura. Our modern facilities are designed to provide the best learning experience for JEE and NEET aspirants.</p>
  <p><a href="${SITE_URL}/courses">Explore Courses</a> | <a href="${SITE_URL}/contact">Schedule a Visit</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Campus Gallery | Dhriti Classes Mathura",
      description: "Take a virtual tour of Dhriti Classes' state-of-the-art campus, smart classrooms, and study environment in Mathura.",
      canonical: `${SITE_URL}/gallery`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Gallery", path: "/gallery" }]),
      ],
      body,
    })
  );
});

// ─── Testimonials ────────────────────────────────────────────────────

router.get("/testimonials", async (req, res) => {
  const body = `
<article>
  <h1>Student Reviews & Testimonials — Dhriti Classes Mathura</h1>
  <p>Read real reviews from students and parents about their experience at Dhriti Classes, Mathura's trusted JEE & NEET coaching institute. Our students and their families share their success stories and how Dhriti Classes helped them achieve their goals.</p>
  <p><a href="${SITE_URL}/courses">Start Your Journey</a> | <a href="${SITE_URL}/contact">Contact Us</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Student Reviews & Testimonials | Dhriti Classes Mathura",
      description: "Read real reviews from students and parents about their experience at Dhriti Classes, Mathura's trusted JEE & NEET coaching institute.",
      canonical: `${SITE_URL}/testimonials`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Testimonials", path: "/testimonials" }]),
      ],
      body,
    })
  );
});

// ─── Login ───────────────────────────────────────────────────────────

router.get("/login", async (req, res) => {
  const body = `
<article>
  <h1>Student Login — Dhriti Classes</h1>
  <p>Log in to access your dashboard, study materials, tests, and track your progress at Dhriti Classes.</p>
  <p><a href="${SITE_URL}/courses">View Courses</a> | <a href="${SITE_URL}/contact">Need Help? Contact Us</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Student Login | Dhriti Classes",
      description: "Log in to your Dhriti Classes student portal to access study materials, tests, and track your progress.",
      canonical: `${SITE_URL}/login`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Login", path: "/login" }]),
      ],
      body,
    })
  );
});

// ─── Policies ────────────────────────────────────────────────────────

router.get("/policies", async (req, res) => {
  const body = `
<article>
  <h1>Terms & Conditions — Dhriti Classes</h1>
  <p>Read the terms of service, privacy policy, refund policy, and other legal information for Dhriti Classes coaching institute in Mathura.</p>
  <p><a href="${SITE_URL}">Back to Homepage</a></p>
</article>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    buildPage({
      title: "Terms & Conditions | Privacy Policy | Dhriti Classes",
      description: "Read the terms of service, privacy policy, refund policy, and other legal information for Dhriti Classes.",
      canonical: `${SITE_URL}/policies`,
      schemas: [
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Terms & Conditions", path: "/policies" }]),
      ],
      body,
    })
  );
});

module.exports = router;
