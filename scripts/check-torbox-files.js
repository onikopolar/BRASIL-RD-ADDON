const https = require('https');
const TARGET_HASH = '9ec526080549232502eb87b12dbd3993391b9d09';
const opts = {
  hostname: 'api.torbox.app',
  path: '/v1/api/torrents/mylist',
  headers: { Authorization: 'Bearer fadbcd61-0d57-4fe4-b77e-5fa2d26808bd' }
};
https.get(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      const list = j.data || j;
      if (!Array.isArray(list)) {
        console.log('Unexpected:', JSON.stringify(j).substring(0, 200));
        return;
      }
      console.log('Total torrents:', list.length);
      const found = list.filter(t => t.hash && t.hash.toLowerCase() === TARGET_HASH);
      if (found.length === 0) {
        console.log('Hash not found in mylist. Searching by name...');
        const byName = list.filter(t => t.name && t.name.includes('S02E01'));
        byName.forEach(t => {
          console.log('  id:', t.id, 'hash:', t.hash, 'name:', t.name?.substring(0, 80), 'state:', t.download_state, 'files:', t.files?.length);
          if (t.files) t.files.forEach((f, i) => console.log('    ' + i + ': ' + f.name + ' (' + (f.size / 1048576).toFixed(1) + 'MB)'));
        });
        return;
      }
      found.forEach(t => {
        console.log('Torrent:', t.name);
        console.log('State:', t.download_state);
        console.log('Files (' + (t.files?.length || 0) + '):');
        if (t.files) t.files.forEach((f, i) => console.log(i + ': id=' + f.id + ' name=' + f.name + ' (' + (f.size / 1048576).toFixed(1) + 'MB)'));
      });
    } catch (e) {
      console.log('Error:', e.message, 'Raw:', d.substring(0, 500));
    }
  });
}).on('error', e => console.log('Err:', e.message));
