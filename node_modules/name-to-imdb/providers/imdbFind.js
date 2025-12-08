var needle = require("needle")
var helpers = require("../helpers")

function validImdbId(id) {
    return !!id.match(/tt\d{7,8}/g)
}

function getImdbResults(searchTerm, cb) {

    var url = 'https://sg.media-imdb.com/suggests/' + searchTerm.charAt(0).toLowerCase() + '/' + encodeURIComponent(searchTerm)  + '.json'

    needle.get(url, function(err, res) {

        if (!err && res.statusCode == 200 && res.body) {

            var imdbParse = JSON.parse(res.body.toString().match(/{.*}/g))

            var results = imdbParse.d

            cb(results && results.length ? results : false, url)

        } else
            cb(false)
    })
}

function imdbFind(task, cb, loose) {
    var fail = function() { cb(null, null) }
    // we first search imdb with a name + year query (if we have a year set)
    // if it fails we search by name query only (looser)
    // we shouldn't retry if there's no year, because it searched
    // without a year in the first attempt already
    var shouldRetry = !loose && task.year

    var retry = function() {
        return shouldRetry ? imdbFind(task, cb, true) : fail()
    }

    var searchTerm = shouldRetry ? task.name + ' ' + task.year : task.name

    getImdbResults(searchTerm, function(results, url) {
        if (results)
            matchSimilar(results, function(result) {
                if (result)
                    cb(null, result, { match: url })
                else
                    retry()
            })
        else
            retry()
    })
    
    var matchSimilar = function(results, callback) {

        // similarity target for levenshtein distance
        var similarityGoal = 0.6

        var pick, secondBest, firstResult

        results.forEach(function(result) {

            if (!(result || {}).id || !validImdbId(result.id))
                return

            // make result readable, the imdb result keys make no sense otherwise
            var res = {
                id: result.id,
                name: result.l,
                year: result.y,
                type: result.q,
                yearRange: result.yr,
                image: result.i ? {
                    src: result.i[0],
                    width: result.i[1],
                    height: result.i[2]
                } : undefined,
                starring: result.s,
            }

            var movieMatch = task.type == 'movie' && ['feature', 'TV special'].indexOf(res.type) > -1

            var seriesMatch = task.type == 'series' && ['TV series', 'TV mini-series'].indexOf(res.type) > -1

            if (!task.type || movieMatch || seriesMatch) {

                if (helpers.yearSimilar(task.year, res.year)) {

                    // try to match by levenshtein distance
                    var similarity = helpers.nameSimilar(task.name, res.name)

                    if (similarity > similarityGoal) {
                        if (!pick || (pick && similarity > pick.similarity)) {
                            pick = res
                            pick.similarity = similarity
                        }
                    }

                    // fallback to non-levenshtein distance logic:
                    // if the result name includes the task name or vice-versa (at end or start)
                    if (!secondBest && helpers.nameAlmostSimilar(task.name, res.name))
                        secondBest = res

                    // if nothing else is found, pick first result
                    // (because what we're searching for might be the alternative name of the first result)
                    // this is ignored if strict mode enabled
                    if (!firstResult && !task.strict)
                        firstResult = res
                }

            }
        })

        // if pick doesn't include the task name (because it's only the most similar textually)
        // then pick the second best result (because it does)
        // example scenario:
        // task.name = 'Ghost Hound'
        // pick.name = 'Ghost Hunt'
        // secondBest.name = 'Shinreigari: Ghost Hound'

        if (secondBest && pick) {
            if (!helpers.nameAlmostSimilar(task.name, pick.name))
                pick = secondBest
        }

        callback(pick || secondBest || firstResult || null)
    }

}

 module.exports = imdbFind
