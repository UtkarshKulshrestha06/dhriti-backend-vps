const { uploadFile, deleteFile } = require("./ftpService");
const prisma = require("./prisma");
// standard node fetch might be global in node 18+, but require if node-fetch is installed
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)).catch(() => global.fetch(...args));

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://dhriticlasses.com";
const FTP_BASE_PATH = process.env.FTP_BASE_PATH || "public_html";

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getBlocks = (post) => post.content_blocks || post.sections || [];

const slugifyHeading = (value, index) =>
  `${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "") || "section"}-${index}`;

const renderBlocks = (blocks) => blocks.map((block, index) => {
  const id = block.id || `block-${index}`;
  switch (block.type) {
    case "heading": {
      const level = Math.min(4, Math.max(2, Number(block.level || 2)));
      const headingId = slugifyHeading(block.content || "", index);
      return `<h${level} id="${headingId}">${escapeHtml(block.content || "")}</h${level}>`;
    }
    case "paragraph": return `<p>${escapeHtml(block.content || "")}</p>`;
    case "list": {
      const tag = block.style === "ordered" ? "ol" : "ul";
      const items = Array.isArray(block.content) ? block.content : [];
      return `${block.heading ? `<h3>${escapeHtml(block.heading)}</h3>` : ""}<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
    }
    case "image": return `<figure><img src="${escapeHtml(block.imageUrl || "")}" alt="${escapeHtml(block.alt || block.caption || "")}" loading="lazy">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
    case "table": return `<table>${block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : ""}<thead><tr>${(block.headers || []).map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${(block.rows || []).map((row) => {
      const cells = Array.isArray(row) ? row : String(row || "").split("|").map((cell) => cell.trim());
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table>`;
    case "faq": return `<section>${(block.items || []).filter((item) => typeof item === "object" && item).map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join("")}</section>`;
    default: return "";
  }
}).join("\n");

const getFaqSchema = (blocks) => {
  const items = blocks
    .filter((block) => block.type === "faq")
    .flatMap((block) => block.items || [])
    .filter((item) => item.question && item.answer);
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
};

const breadcrumbSchema = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: item.url,
  })),
});

const postSchema = (post) => {
  const canonical = post.canonical_url || `${SITE_URL}/blogs/${post.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    image: post.cover_image ? [post.cover_image] : undefined,
    description: post.meta_description || post.excerpt || "",
    keywords: [post.focus_keyword, ...(post.secondary_keywords || []), ...(post.tags || [])].filter(Boolean).join(", "),
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    mainEntityOfPage: canonical,
    author: { "@type": "Person", name: post.author?.name || post.author_name || "Dhriti Classes" },
    publisher: { "@type": "EducationalOrganization", name: "Dhriti Classes", logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` } },
  };
};

const headTags = ({ title, description, canonical, image, type = "website", noindex = false, schema = [] }) => {
  const schemas = schema.filter(Boolean).map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`).join("\n");
  return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta name="robots" content="${noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}">
    <meta property="og:site_name" content="Dhriti Classes">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="${escapeHtml(type)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:image" content="${escapeHtml(image || `${SITE_URL}/logo.png`)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(image || `${SITE_URL}/logo.png`)}">
    ${schemas}
  `;
};

const injectHtml = (template, tags, body) => {
  const withoutDynamicTitle = template
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta name="description"[\s\S]*?>/i, "");
  return withoutDynamicTitle
    .replace("</head>", `${tags}\n</head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
};

const renderPostBody = (post) => {
  const blocks = getBlocks(post);
  return `
    <main class="seo-prerender">
      <article>
        <p>${escapeHtml([post.exam, post.subject, post.chapter].filter(Boolean).join(" / "))}</p>
        <h1>${escapeHtml(post.title)}</h1>
        <p>${escapeHtml(post.excerpt || "")}</p>
        ${post.cover_image ? `<img src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(post.cover_image_alt || post.title)}">` : ""}
        ${renderBlocks(blocks)}
      </article>
    </main>
  `;
};

const renderListingBody = (posts, heading = "JEE & NEET Articles") => `
  <main class="seo-prerender">
    <h1>${escapeHtml(heading)}</h1>
    <p>JEE and NEET preparation articles, concepts, formulas, study strategy, and exam updates from Dhriti Classes.</p>
    <section>
      ${posts.map((post) => `<article><h2><a href="/blogs/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2><p>${escapeHtml(post.excerpt || "")}</p></article>`).join("\n")}
    </section>
  </main>
`;

let cachedTemplate = null;
async function fetchBaseTemplate() {
  if (cachedTemplate) return cachedTemplate;
  try {
    const res = await fetch(`${SITE_URL}/index.html`);
    if (res.ok) cachedTemplate = await res.text();
    return cachedTemplate;
  } catch (err) {
    console.error("[SEO Prerender] Failed to fetch base template:", err);
    return null;
  }
}

async function prerenderAndUploadBlog(post) {
  try {
    const template = await fetchBaseTemplate();
    if (!template) throw new Error("Base template not available");

    const blocks = getBlocks(post);
    const route = `/blogs/${post.slug}`;
    const canonical = post.canonical_url || `${SITE_URL}${route}`;

    const tags = headTags({
      title: post.seo_title || `${post.title} | Dhriti Classes`,
      description: post.meta_description || post.excerpt || "",
      canonical,
      image: post.og_image || post.cover_image,
      type: "article",
      noindex: Boolean(post.noindex),
      schema: [
        breadcrumbSchema([{ name: "Home", url: SITE_URL }, { name: "Blogs", url: `${SITE_URL}/blogs` }, { name: post.title, url: `${SITE_URL}${route}` }]),
        postSchema(post),
        getFaqSchema(blocks),
      ],
    });

    const finalHtml = injectHtml(template, tags, renderPostBody(post));
    const remotePath = `${FTP_BASE_PATH}/blogs/${post.slug}/index.html`;

    console.log(`[SEO Prerender] Uploading blog HTML for ${post.slug}...`);
    await uploadFile(Buffer.from(finalHtml, "utf8"), remotePath);
  } catch (err) {
    console.error("[SEO Prerender] Failed to upload blog:", err.message);
  }
}

async function prerenderAndUploadBlogListing() {
  try {
    const template = await fetchBaseTemplate();
    if (!template) throw new Error("Base template not available");

    const posts = await prisma.blogPost.findMany({
      where: { status: "PUBLISHED", noindex: false, OR: [{ published_at: null }, { published_at: { lte: new Date() } }] },
      select: { slug: true, title: true, excerpt: true },
      orderBy: [{ published_at: "desc" }],
    });

    const tags = headTags({
      title: "JEE & NEET Preparation Blog | Dhriti Classes",
      description: "Read Dhriti Classes blogs for JEE and NEET exam tips, study plans, concepts, formulas, notes, and admission updates.",
      canonical: `${SITE_URL}/blogs`,
      schema: [
        breadcrumbSchema([{ name: "Home", url: SITE_URL }, { name: "Blogs", url: `${SITE_URL}/blogs` }]),
        {
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Dhriti Classes Blog",
          blogPost: posts.slice(0, 20).map((post) => ({ "@type": "BlogPosting", headline: post.title, url: `${SITE_URL}/blogs/${post.slug}` })),
        },
      ],
    });

    const finalHtml = injectHtml(template, tags, renderListingBody(posts));
    const remotePath = `${FTP_BASE_PATH}/blogs/index.html`;

    console.log(`[SEO Prerender] Uploading blog listing HTML...`);
    await uploadFile(Buffer.from(finalHtml, "utf8"), remotePath);
  } catch (err) {
    console.error("[SEO Prerender] Failed to upload blog listing:", err.message);
  }
}

async function deletePrerenderedBlog(slug) {
  try {
    const remotePath = `${FTP_BASE_PATH}/blogs/${slug}/index.html`;
    await deleteFile(remotePath);
    console.log(`[SEO Prerender] Deleted HTML for archived blog: ${slug}`);
  } catch (err) {
    console.warn(`[SEO Prerender] Failed to delete HTML for ${slug} (might not exist):`, err.message);
  }
}

module.exports = {
  prerenderAndUploadBlog,
  prerenderAndUploadBlogListing,
  deletePrerenderedBlog,
};
