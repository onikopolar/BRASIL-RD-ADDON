# Usage example
	npm install all-debrid-api --save
```javascript
const AllDebridClient = require('all-debrid-api')
const AD = new AllDebridClient('Your API Token')

AD.magnet.instant(['infoHash1', 'infoHash2']).then(results => console.log(results));
AD.link.infos('some-link').then(results => console.log(results));
PM.magnet.upload('someMagnetLink').then(results => console.log(results));

```
