# Usage example
	npm install premiumize-api --save
```javascript
const PremiumizeClient = require('premiumize-api')
const PM = new PremiumizeClient('Your API Token')

PM.cache.check(['infoHash1', 'infoHash2']).then(results => console.log(results));
PM.item.listAll().then(results => console.log(results));
PM.transfer.create('someMagnetLink').then(results => console.log(results));

```
