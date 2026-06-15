require('dotenv').config();
const ftp = require('basic-ftp');
const { Readable } = require('stream');

const FTP_CONFIG = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  secure: process.env.FTP_SECURE === 'true',
};

console.log('Testing FTP connection...');
console.log('Host:', FTP_CONFIG.host);
console.log('User:', FTP_CONFIG.user);
console.log('Secure:', FTP_CONFIG.secure);
console.log('Base Path:', process.env.FTP_BASE_PATH);

async function testFtp() {
  const client = new ftp.Client(10000); // 10s timeout
  client.ftp.verbose = true;
  try {
    await client.access(FTP_CONFIG);
    console.log('\n✅ FTP CONNECTED SUCCESSFULLY');

    const pwd = await client.pwd();
    console.log('Current dir:', pwd);

    // Test ensureDir
    const testDir = process.env.FTP_BASE_PATH + '/blogs';
    console.log('\nTesting ensureDir:', testDir);
    await client.ensureDir(testDir);
    const newPwd = await client.pwd();
    console.log('After ensureDir, CWD:', newPwd);

    // Test upload of a tiny file
    const testBuffer = Buffer.from('hello world test upload');
    const stream = Readable.from(testBuffer);
    const testFile = `ftp-test-${Date.now()}.txt`;
    await client.uploadFrom(stream, testFile);
    console.log('\n✅ TEST FILE UPLOADED:', testFile);

    // Clean up
    await client.remove(testFile);
    console.log('✅ TEST FILE DELETED');
    console.log('\n🎉 FTP IS WORKING CORRECTLY!');
  } catch (err) {
    console.error('\n❌ FTP ERROR:', err.message);
    console.error('Code:', err.code);
    console.error('Full:', err);
  } finally {
    client.close();
  }
}

testFtp();
