var fetch = require("node-fetch")
var helpers = require("../helpers")

// Use cinemeta to pull names of movies and series against IMDB IDs
var cinemetaUrls = {
    'movie': 'https://cinemeta.strem.io/stremioget/stremio/v1/q.json?b=eyJwYXJhbXMiOltudWxsLHt9XSwibWV0aG9kIjoibmFtZXMubW92aWUiLCJpZCI6MSwianNvbnJwYyI6IjIuMCJ9',
    'series': 'https://cinemeta.strem.io/stremioget/stremio/v1/q.json?b=eyJwYXJhbXMiOltudWxsLHt9XSwibWV0aG9kIjoibmFtZXMuc2VyaWVzIiwiaWQiOjEsImpzb25ycGMiOiIyLjAifQ==',
}

// Index entry in our in-mem index
function indexEntry(entry) {
    if (entry.year) entry.year = parseInt(entry.year.toString().split("-")[0]); // first year for series
    var n = helpers.simplifyName(entry);
    if (!meta[n]) meta[n] = [];
    meta[n].push(entry);
    byImdb[entry.imdb_id] = entry;
}

// Find in our metadata set
var pulled = { movie: false, series: false };
var meta = { }, byImdb = { };

function metadataFind(query, cb) {
    // It's OK if we don't pass type and we don't fetch names, because we will go to google fallback
    if (query.type && !pulled[query.type] && cinemetaUrls[query.type]) {
        fetch(cinemetaUrls[query.type])
        .then(function(resp) { return resp.json() })
        .then(function(resp) { return resp.result })
        .then(function(res) {
            res.forEach(indexEntry);
            pulled[query.type] = 1;
        })
        .catch(function(e) {
            console.error(e)
        })
        .then(function() {
            match()
        })
    } else process.nextTick(match);

    function match() {
        var name = helpers.simplifyName(query)
        if (!name) return cb(null, null)
        var matches = meta[name] || [ ];
        var m = matches.find(function(match) {
            if (!(match.type === query.type)) return false

            if (query.type === 'movie' && query.hasOwnProperty('year')) 
                return helpers.yearSimilar(query.year, match.year)
           
            return true
        })
        // Uniform the result to imdbFind provider
        var res = m ? {
            id: m.imdb_id,
            name: m.name,
            year: m.year,
            type: m.type,
            yearRange: undefined,
            image: undefined,
            starring: undefined,
            similarity: undefined,
        } : false;
        return cb(null, res);
    };
}


module.exports = metadataFind
