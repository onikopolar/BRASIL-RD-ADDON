const http = require('http');

const testUrls = [
  'http://localhost:7000/videos/downloading_v2.mp4',
  'http://localhost:7000/static/videos/downloading_v2.mp4',
  'http://localhost:7000/static/downloading',
  'http://localhost:7000/static/video/downloading'
];

async function testUrl(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'HEAD' }, (res) => {
      console.log(`${url} - Status: ${res.statusCode} ${res.statusMessage}`);
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    
    req.on('error', (err) => {
      console.log(`${url} - Error: ${err.message}`);
      resolve();
    });
    
    req.setTimeout(5000, () => {
      console.log(`${url} - Timeout`);
      req.destroy();
      resolve();
    });
    
    req.end();
  });
}

async function runTests() {
  console.log('Testing URLs...\n');
  for (const url of testUrls) {
    await testUrl(url);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log('\nTests completed.');
}

runTests();
