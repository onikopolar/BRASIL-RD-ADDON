const Parser = require("./src/parser").Parser;
const handlers = require("./src/handlers");
const trasformers = require("./src/transformers");

const defaultParser = new Parser();

handlers.addDefaults(defaultParser);

exports.addDefaults = handlers.addDefaults;
exports.addHandler = (handlerName, handler, options) => defaultParser.addHandler(handlerName, handler, options);
exports.parse = title => defaultParser.parse(title);
exports.Parser = Parser;
exports.Transformers = trasformers;
