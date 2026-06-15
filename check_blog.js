const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.blogPost.findUnique({
  where: { id: '6fcad25b-0a2d-4e96-8a78-c91afd2623fe' },
}).then(post => {
  if (!post) { console.log('NOT FOUND'); return; }
  console.log(JSON.stringify({
    id: post.id,
    title: post.title,
    exam: post.exam,
    exams: post.exams,
    subject: post.subject,
    subjects: post.subjects,
    class_level: post.class_level,
    class_levels: post.class_levels,
    topic_id: post.topic_id,
    topic_ids: post.topic_ids,
  }, null, 2));
}).catch(e => console.error(e.message)).finally(() => prisma.$disconnect());
