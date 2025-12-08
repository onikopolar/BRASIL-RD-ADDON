# Usage example
	npm install offcloud-api --save
```javascript
const OffcloudClient = require('offcloud-api')
const OC = new OffcloudClient('Your API Token')

OC.instant.cache(['infoHash1', 'infoHash2']).then(results => console.log(results));
OC.cloud.download('someMagnetLink').then(results => console.log(results));
OC.cloud.history().then(results => console.log(results));
```
