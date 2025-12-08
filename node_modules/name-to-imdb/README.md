# name-to-imdb
Map names of movies/series to IMDB IDs

```bash
npm install name-to-imdb
```

## Usage: nameToImdb(args, callback)

**args** - string of the name or object with name/year/type - ``{ name: "The Devil Bat", year: 1940, type: "movie" }``

**args.providers** - an array of providers to search in; possible options are ``metadata`` and ``imdbFind``; default is ``["metadata", "imdbFind"]``

**callback** - A function that is called with either an error or the IMDB ID and match info. If no callback is provided, a Promise is returned instead.

## Examples
### imdbFind provider
```js
var nameToImdb = require("name-to-imdb");
nameToImdb("south park", function(err, res, inf) { 
  console.log(res); // "tt0121955"
  // inf contains info on where we matched that name - e.g. metadata, or on imdb
  // and the meta object with all the available data
  console.log(inf);
})
```

```js
// console.log(inf.meta)
{
  id: 'tt0121955',
  name: 'South Park',
  year: 1997,
  type: 'TV series',
  yearRange: '1997-',
  image: {
    src: 'https://m.media-amazon.com/images/M/MV5BOGE2YWUzMDItNTg2Ny00NTUzLTlmZGYtNWMyNzVjMjQ3MThkXkEyXkFqcGdeQXVyNTA4NzY1MzY@._V1_.jpg',
    width: 680,
    height: 1000
  },
  starring: 'Trey Parker, Matt Stone',
  similarity: 1
}
```

```js
var nameToImdb = require("name-to-imdb");
nameToImdb("south park")
  .then(function ({res,inf}) {
    console.log(res); // "tt0121955"
    console.log(inf); // {match: 'metadata', isCached: false, meta: {...}}
  })
  .catch(function (error) {
    console.error(error);
  });
```

```js
var nameToImdb = require("name-to-imdb");

async function search() {
  try {
    var result = await nameToImdb({ name: "The Matrix", year: 1999 });
    console.log(result.res); // "tt0133093"
    console.log(result.inf); // {match: 'metadata', isCached: false, meta: {...}}
  } catch (error) {
    console.error(error);
  }
}

search();
```

### metadata provider

```js
var nameToImdb = require("name-to-imdb");
nameToImdb({ name: "south park", type: 'series', providers: ['metadata'] }, function (err, res, inf) {
  console.log(res); // "tt0121955"
  // inf contains info on where we matched that name - e.g. metadata, or on imdb
  // and the meta object with all the available data
  console.log(inf); // inf: { match, meta }
})
```

```js
// console.log(inf.meta)
{
  id: 'tt0121955',
  name: 'South Park',
  year: 1997,
  type: 'series',
  yearRange: undefined, // imdbFind only
  image: undefined,     // imdbFind only
  starring: undefined,  // imdbFind only
  similarity: undefined // imdbFind only
}
```

> Note: while using "metadata" provider, you must specify the media type and the name must be in english
