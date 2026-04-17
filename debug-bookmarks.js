require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const http = require('http');

const prisma = new PrismaClient();

async function makeRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function main() {
    console.log('\n=== DATABASE CHECK ===');
    const bookmarkCount = await prisma.bookmarks.count();
    const notebookCount = await prisma.notebooks.count();
    const attemptCount = await prisma.testAttempts.count();
    console.log(`Bookmarks: ${bookmarkCount}, Notebooks: ${notebookCount}, TestAttempts: ${attemptCount}`);

    // Get a user who has bookmarks
    const userWithBookmarks = await prisma.bookmarks.findFirst({ select: { user_id: true } });
    const userWithNotebooks = await prisma.notebooks.findFirst({ select: { user_id: true, id: true } });
    console.log('User with bookmarks:', userWithBookmarks?.user_id);
    console.log('User with notebooks:', JSON.stringify(userWithNotebooks));

    if (userWithBookmarks) {
        const user = await prisma.user.findUnique({
            where: { id: userWithBookmarks.user_id },
            select: { email: true, id: true, role: true }
        });
        console.log('User details:', JSON.stringify(user));

        console.log('\n=== LOGIN TEST ===');
        const loginBody = JSON.stringify({ email: user.email, password: 'password123' });
        const loginRes = await makeRequest({
            host: 'localhost', port: 3001,
            path: '/api/auth/login', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
        }, loginBody);

        console.log('Login status:', loginRes.status);
        
        if (loginRes.status !== 200) {
            console.log('Login failed:', JSON.stringify(loginRes.body));
            // Try to get a token via JWT directly
            const jwt = require('jsonwebtoken');
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            console.log('\n=== USING DIRECTLY MINTED TOKEN ===');
            await testBookmarks(token, userWithNotebooks?.id);
        } else {
            console.log('Login OK, user:', loginRes.body.user?.email);
            await testBookmarks(loginRes.body.token, userWithNotebooks?.id);
        }
    }
}

async function testBookmarks(token, notebookId) {
    console.log('\n=== BOOKMARK ENDPOINT TESTS ===');
    console.log('Token:', token?.substring(0, 50) + '...');

    const headers = { 'Authorization': `Bearer ${token}` };

    // Test GET /api/bookmarks/notebooks
    const nbRes = await makeRequest({
        host: 'localhost', port: 3001,
        path: '/api/bookmarks/notebooks', method: 'GET',
        headers
    });
    console.log('\nGET /api/bookmarks/notebooks');
    console.log('  Status:', nbRes.status);
    console.log('  Body:', JSON.stringify(nbRes.body).substring(0, 200));

    if (notebookId) {
        // Test GET /api/bookmarks/notebooks/:id/questions
        const qRes = await makeRequest({
            host: 'localhost', port: 3001,
            path: `/api/bookmarks/notebooks/${notebookId}/questions?limit=5`, method: 'GET',
            headers
        });
        console.log(`\nGET /api/bookmarks/notebooks/${notebookId}/questions`);
        console.log('  Status:', qRes.status);
        console.log('  Body:', JSON.stringify(qRes.body).substring(0, 400));
    }

    // Test GET /api/bookmarks/bookmarked-ids
    const idsRes = await makeRequest({
        host: 'localhost', port: 3001,
        path: '/api/bookmarks/bookmarked-ids', method: 'GET',
        headers
    });
    console.log('\nGET /api/bookmarks/bookmarked-ids');
    console.log('  Status:', idsRes.status);
    console.log('  Body:', JSON.stringify(idsRes.body).substring(0, 200));

    // Test GET /tests/attempts/me
    const attRes = await makeRequest({
        host: 'localhost', port: 3001,
        path: '/api/tests/attempts/me', method: 'GET',
        headers
    });
    console.log('\nGET /api/tests/attempts/me');
    console.log('  Status:', attRes.status);
    console.log('  Count:', Array.isArray(attRes.body) ? attRes.body.length : 'N/A');
    console.log('  Body:', JSON.stringify(attRes.body).substring(0, 200));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
