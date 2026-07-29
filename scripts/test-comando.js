var axios = require('axios');
var https = require('https');
var dns = require('dns');
var tls = require('tls');
var cheerio = require('cheerio');
dns.setServers(['8.8.8.8', '1.1.1.1']);

class DnsAgent extends https.Agent {
  createConnection(opts, cb) {
    dns.resolve4(opts.hostname || opts.host, function(err, addrs) {
      if (err) return cb(err);
      var s = tls.connect({
        host: addrs[0],
        port: opts.port || 443,
        servername: opts.hostname,
        rejectUnauthorized: false
      }, function() { cb(null, s); });
      s.on('error', cb);
    });
  }
}
var agent = new DnsAgent({ keepAlive: true });

axios.get('https://comando1.com/wp-json/wp/v2/posts?include=127236', {
  timeout: 10000,
  httpsAgent: agent,
  headers: { 'User-Agent': 'Mozilla/5.0' }
}).then(function(r) {
  var p = r.data[0];
  console.log('Title:', p.title.rendered);
  var $ = cheerio.load(p.content.rendered);
  var magnets = $('a[href^="magnet:"]');
  console.log('Magnets found:', magnets.length);
  magnets.each(function(i, el) {
    var href = $(el).attr('href');
    console.log(' ', i, href ? href.substring(0, 120) : 'N/A');
  });
}).catch(function(e) {
  console.log('ERRO:', e.message);
});
