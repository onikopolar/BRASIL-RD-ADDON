# Usage example
	npm install debrid-link-api --save
```javascript
const DebridLinkClient = require('debrid-link-api')
const DL = new DebridLinkClient('Your API Token')

DL.seedbox.cached('infoHash1,infoHash2').then(results => console.log(results));
DL.seedbox.activity('some-id').then(results => console.log(results));
DL.seedbox.add('someMagnetLink').then(results => console.log(results));

```
