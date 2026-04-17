const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const SUPABASE_URL = 'https://cydbcragrhnlciahawil.supabase.co';
// Using the service role key to bypass all RLS policies!
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5ZGJjcmFncmhubGNpYWhhd2lsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTk2NTQwNywiZXhwIjoyMDg1NTQxNDA3fQ.qWLIxlNWOxUKxbEEOmgxvd8MEeY7T8iowVnxGCDjVFo';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const prisma = new PrismaClient();

async function fetchAll(table) {
  let { data, error } = await supabase.from(table).select('*');
  if (error) {
    throw new Error(`Error fetching ${table}: ${error.message}`);
  }
  return data;
}

async function run() {
  try {
    console.log('🔄 Starting Core Data Migration from Supabase to Prisma...');

    // 1. Streams
    console.log('[1/7] Fetching Streams...');
    const streamsData = await fetchAll('streams');
    for (const st of streamsData) {
      await prisma.streams.upsert({
        where: { id: st.id },
        update: {},
        create: {
          id: st.id,
          title: st.title,
          description: st.description,
          created_at: st.created_at ? new Date(st.created_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${streamsData.length} Streams.`);

    // 2. Batches
    console.log('[2/7] Fetching Batches...');
    const batchesData = await fetchAll('batches');
    for (const bt of batchesData) {
      await prisma.batches.upsert({
        where: { id: bt.id },
        update: {},
        create: {
          id: bt.id,
          stream_id: bt.stream_id,
          title: bt.title,
          subtitle: bt.subtitle,
          description: bt.description,
          class_name: bt.class_name,
          target_year: bt.target_year,
          duration: bt.duration,
          price: bt.price,
          registration_fee: bt.registration_fee,
          batch_date: bt.batch_date ? new Date(bt.batch_date) : undefined,
          end_date: bt.end_date ? new Date(bt.end_date) : undefined,
          syllabus_url: bt.syllabus_url,
          image_url: bt.image_url,
          color_theme: bt.color_theme,
          is_active: bt.is_active,
          created_at: bt.created_at ? new Date(bt.created_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${batchesData.length} Batches.`);

    // 3. Subjects
    console.log('[3/7] Fetching Subjects...');
    const subjectsData = await fetchAll('subjects');
    for (const sub of subjectsData) {
      await prisma.subjects.upsert({
        where: { id: sub.id },
        update: {},
        create: {
          id: sub.id,
          batch_id: sub.batch_id,
          name: sub.name,
          order_index: sub.order_index,
          created_at: sub.created_at ? new Date(sub.created_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${subjectsData.length} Subjects.`);

    // 4. Chapters
    console.log('[4/7] Fetching Chapters...');
    const chaptersData = await fetchAll('chapters');
    for (const ch of chaptersData) {
      await prisma.chapters.upsert({
        where: { id: ch.id },
        update: {},
        create: {
          id: ch.id,
          subject_id: ch.subject_id,
          batch_id: ch.batch_id,
          title: ch.title,
          chapter_number: ch.chapter_number,
          created_at: ch.created_at ? new Date(ch.created_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${chaptersData.length} Chapters.`);

    // 5. Resources
    console.log('[5/7] Fetching Resources...');
    const resData = await fetchAll('resources');
    for (const r of resData) {
      await prisma.resources.upsert({
        where: { id: r.id },
        update: {},
        create: {
          id: r.id,
          batch_id: r.batch_id,
          subject_id: r.subject_id,
          chapter_id: r.chapter_id,
          title: r.title,
          type: r.type,
          file_url: r.file_url,
          file_size: r.file_size ? BigInt(r.file_size) : null,
          uploaded_by: r.uploaded_by,
          is_free: r.is_free,
          created_at: r.created_at ? new Date(r.created_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${resData.length} Resources.`);

    // 6. Announcements
    console.log('[6/7] Fetching Announcements...');
    const annData = await fetchAll('announcements');
    for (const a of annData) {
      await prisma.announcements.upsert({
        where: { id: a.id },
        update: {},
        create: {
          id: a.id,
          batch_id: a.batch_id,
          title: a.title,
          message: a.message,
          author_id: a.author_id,
          is_important: a.is_important,
          tags: a.tags ? a.tags : [],
          created_at: a.created_at ? new Date(a.created_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${annData.length} Announcements.`);

    // 7. Enrollments
    console.log('[7/7] Fetching Enrollments...');
    const enrData = await fetchAll('enrollments');
    for (const e of enrData) {
      await prisma.enrollments.upsert({
        where: { 
          user_id_batch_id: { 
             user_id: e.user_id, 
             batch_id: e.batch_id 
          } 
        },
        update: {},
        create: {
          user_id: e.user_id,
          batch_id: e.batch_id,
          enrolled_at: e.enrolled_at ? new Date(e.enrolled_at) : undefined
        }
      });
    }
    console.log(`✅ Migrated ${enrData.length} Enrollments.`);

    console.log('🎉🎉 All Core Data Successfully Migrated to Local PostgreSQL!');
  } catch (error) {
    console.error('Migration Aborted:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
