require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.blogPost.findMany({ include: { author: true }, orderBy: { created_at: 'desc' } })
  .then(posts => {
    console.log('\n=== TOTAL BLOGS IN DB:', posts.length, '===\n');
    posts.forEach(post => {
      console.log('---');
      console.log('ID:         ', post.id);
      console.log('Title:      ', post.title);
      console.log('Status:     ', post.status);
      console.log('Slug:       ', post.slug);
      console.log('Category:   ', post.category);
      console.log('Exams:      ', JSON.stringify(post.exams));
      console.log('ClassLevels:', JSON.stringify(post.class_levels));
      console.log('Subjects:   ', JSON.stringify(post.subjects));
      console.log('TopicIDs:   ', JSON.stringify(post.topic_ids));
      console.log('Tags:       ', JSON.stringify(post.tags));
      console.log('Author:     ', post.author ? post.author.name : '(none)');
      console.log('CoverImage: ', post.cover_image ? 'YES' : 'no');
      console.log('Blocks:     ', Array.isArray(post.content_blocks) ? post.content_blocks.length + ' block(s)' : '0');
      console.log('Created:    ', post.created_at);
      console.log('Published:  ', post.published_at || 'not published');
    });
  })
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => prisma.$disconnect());
