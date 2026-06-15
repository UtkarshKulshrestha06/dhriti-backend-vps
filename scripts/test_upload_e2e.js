require('dotenv').config();
const http = require('http');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');

const token = jwt.sign({ id: 'test-admin', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Create a valid 100x100 gradient image using sharp
sharp({
  create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 150, b: 200 } }
})
  .jpeg({ quality: 80 })
  .toBuffer()
  .then(imgBuffer => {
    console.log('Created test image:', imgBuffer.length, 'bytes');

    const boundary = 'TestBoundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="image"; filename="test-upload.jpg"\r\n' +
        'Content-Type: image/jpeg\r\n\r\n'
      ),
      imgBuffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/blogs/upload-image',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    };

    console.log('Sending upload request...');
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('\nHTTP Status:', res.statusCode);
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200) {
            console.log('✅ UPLOAD SUCCESS!');
            console.log('   URL:', json.url);
          } else {
            console.log('❌ UPLOAD FAILED:', json.error);
            console.log('   Details:', json.details);
          }
        } catch (e) {
          console.log('Raw response:', data);
        }
      });
    });

    req.on('error', e => console.error('Request error:', e.message));
    req.write(body);
    req.end();
  })
  .catch(e => console.error('Sharp error:', e.message));
