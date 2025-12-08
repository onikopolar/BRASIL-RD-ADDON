var helpers = {}

helpers.yearSimilar = function(parsedYear, altYear) {
    if (!parsedYear || !altYear) return true
    else {
        parsedYear = parseInt(parsedYear)
        altYear = parseInt(altYear)
        if (altYear >= parsedYear -1 && altYear <= parsedYear +1)
            return true
    }
    return false
}

helpers.levenshteinDistance = function(s1, s2) {

    function editDistance(s1, s2) {
      s1 = s1.toLowerCase()
      s2 = s2.toLowerCase()
    
      var costs = new Array()

      for (var i = 0; i <= s1.length; i++) {
        var lastValue = i
        for (var j = 0; j <= s2.length; j++) {
          if (i == 0)
            costs[j] = j
          else {
            if (j > 0) {
              var newValue = costs[j - 1]
              if (s1.charAt(i - 1) != s2.charAt(j - 1))
                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
              costs[j - 1] = lastValue
              lastValue = newValue
            }
          }
        }
        if (i > 0)
          costs[s2.length] = lastValue
      }
      return costs[s2.length]
    }

    var longer = s1
    var shorter = s2

    if (s1.length < s2.length) {
        longer = s2
        shorter = s1
    }

    var longerLength = longer.length

    if (longerLength == 0)
        return 1.0

    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength)
}

helpers.sanitizeName = function(name) {
    return name.replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase().replace('the ','').replace(/\s+/g, ' ').trim()
}

helpers.nameSimilar = function(parsedName, altName) {
    if (!parsedName || !altName) return 0
    else {
        parsedName = helpers.sanitizeName(parsedName)
        altName = helpers.sanitizeName(altName)
        if (parsedName == altName) return 1
        else return helpers.levenshteinDistance(parsedName, altName)
    }
}

helpers.nameAlmostSimilar = function(parsedName, altName) {
    if (!parsedName || !altName) return false
    else {
        parsedName = helpers.sanitizeName(helpers.simplifyName({ name: parsedName }))
        altName = helpers.sanitizeName(helpers.simplifyName({ name: altName }))
        if (parsedName.startsWith(altName) || parsedName.endsWith(altName) || altName.startsWith(parsedName) || altName.endsWith(parsedName))
            return true
    }
    return false
}

// Utility to reduce the name to it's most basic form

helpers.simplifyName = function(args) { 
    if (!args || !args.name)
      return null

    var name = args.name.toLowerCase()
        .trim()
        .replace(/\([^\(]+\)$/, '') // remove brackets at end
        .replace(/&/g, "and") // unify & vs "and"
        .replace(/[^0-9a-z ]+/g, ' ') // remove any special characters
        .split(' ')
        .filter(function(r){ return r })
        .join(' ') // remove any aditional whitespaces

    if (args.year && name.endsWith(' ' + args.year))
        name = name.replace(new RegExp(' ' + args.year + '$', 'i'), '')

    return name

}

helpers.parseSearchTerm = function(searchTerm) {
  if (!searchTerm || typeof searchTerm !== 'string') return null;
  
  var diacritics = require('diacritics').remove;
  
  var res = searchTerm.replace(/[^\u0000-\u036F][ \t]*/gm, '');
  return diacritics(res);
}

module.exports = helpers
