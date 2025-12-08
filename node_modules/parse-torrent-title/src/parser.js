const { none } = require("./transformers");

// chinese/japanese/russian chars https://stackoverflow.com/a/43419070
const NON_ENGLISH_CHARS = "\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\u0400-\u04ff";
const RUSSIAN_CAST_REGEX = new RegExp("\\([^)]*[\u0400-\u04ff][^)]*\\)$|(?<=\\/.*)\\(.*\\)$");
const ALT_TITLES_REGEX = new RegExp(`[^/|(]*[${NON_ENGLISH_CHARS}][^/|]*[/|]|[/|][^/|(]*[${NON_ENGLISH_CHARS}][^/|]*`, "g");
const NOT_ONLY_NON_ENGLISH_REGEX = new RegExp(`(?<=[a-zA-Z][^${NON_ENGLISH_CHARS}]+)[${NON_ENGLISH_CHARS}].*[${NON_ENGLISH_CHARS}]|[${NON_ENGLISH_CHARS}].*[${NON_ENGLISH_CHARS}](?=[^${NON_ENGLISH_CHARS}]+[a-zA-Z])`, "g");
const NOT_ALLOWED_SYMBOLS_AT_START_AND_END = new RegExp(`^[^\\w${NON_ENGLISH_CHARS}#[【★]+|[ \\-:/\\\\[|{(#$&^]+$`, "g");
const REMAINING_NOT_ALLOWED_SYMBOLS_AT_START_AND_END = new RegExp(`^[^\\w${NON_ENGLISH_CHARS}#]+|[[\\]({} ]+$`, "g");

function extendOptions(options) {
    options = options || {};

    const defaultOptions = {
        skipIfAlreadyFound: true, // whether to skip a matcher if another matcher from this group was already found
        skipFromTitle: false, // whether to exclude found match from the end result title
        skipIfFirst: false, // whether to skip this matcher if there are no other groups matched before it's matchIndex
        remove: false // whether to remove the found match from further matchers
    };

    if (typeof options.skipIfAlreadyFound === "undefined") {
        options.skipIfAlreadyFound = defaultOptions.skipIfAlreadyFound;
    }
    if (typeof options.skipFromTitle === "undefined") {
        options.skipFromTitle = defaultOptions.skipFromTitle;
    }
    if (typeof options.skipIfFirst === "undefined") {
        options.skipIfFirst = defaultOptions.skipIfFirst;
    }
    if (typeof options.remove === "undefined") {
        options.remove = defaultOptions.remove;
    }

    return options;
}

function createHandlerFromRegExp(name, regExp, transformer, options) {
    function handler({ title, result, matched }) {
        if (result[name] && options.skipIfAlreadyFound) {
            return null;
        }

        const match = title.match(regExp);
        const [rawMatch, cleanMatch] = match || [];

        if (rawMatch) {
            const transformed = transformer(cleanMatch || rawMatch, result[name]);
            const beforeTitleMatch = title.match(/^\[([^[\]]+)]/);
            const isBeforeTitle = beforeTitleMatch && beforeTitleMatch[1].includes(rawMatch);
            const otherMatches = Object.entries(matched).filter(e => e[0] !== name);
            const isSkipIfFirst = options.skipIfFirst && otherMatches.length &&
                otherMatches.every(e => match.index < e[1].matchIndex);

            if (transformed && !isSkipIfFirst) {
                matched[name] = matched[name] || { rawMatch, matchIndex: match.index };
                result[name] = options.value || transformed;
                return {
                    rawMatch,
                    matchIndex: match.index,
                    remove: options.remove,
                    skipFromTitle: isBeforeTitle || options.skipFromTitle
                };
            }
        }

        return null;
    }

    handler.handlerName = name;

    return handler;
}

function cleanTitle(rawTitle) {
    let cleanedTitle = rawTitle;

    if (cleanedTitle.indexOf(" ") === -1 && cleanedTitle.indexOf(".") !== -1) {
        cleanedTitle = cleanedTitle.replace(/\./g, " ");
    }

    cleanedTitle = cleanedTitle
        .replace(/_/g, " ")
        .replace(/[[(]movie[)\]]/i, "") // clear movie indication flag
        .replace(NOT_ALLOWED_SYMBOLS_AT_START_AND_END, "")
        .replace(RUSSIAN_CAST_REGEX, "") // clear russian cast information
        .replace(/^[[【★].*[\]】★][ .]?(.+)/, "$1") // remove release group markings sections from the start
        .replace(/(.+)[ .]?[[【★].*[\]】★]$/, "$1") // remove unneeded markings section at the end if present
        .replace(ALT_TITLES_REGEX, "") // remove alt language titles
        .replace(NOT_ONLY_NON_ENGLISH_REGEX, "") // remove non english chars if they are not the only ones left
        .replace(REMAINING_NOT_ALLOWED_SYMBOLS_AT_START_AND_END, "")
        .trim();

    return cleanedTitle;
}

class Parser {

    constructor() {
        this.handlers = [];
    }

    addHandler(handlerName, handler, transformer, options) {
        if (typeof handler === "undefined" && typeof handlerName === "function") {

            // If no name is provided and a function handler is directly given
            handler = handlerName;
            handler.handlerName = "unknown";

        } else if (typeof handlerName === "string" && handler instanceof RegExp) {

            // If the handler provided is a regular expression
            transformer = typeof transformer === "function" ? transformer : none;
            options = extendOptions(typeof transformer === "object" ? transformer : options);
            handler = createHandlerFromRegExp(handlerName, handler, transformer, options);

        } else if (typeof handler === "function") {

            // If the handler is a function
            handler.handlerName = handlerName;

        } else {

            // If the handler is neither a function nor a regular expression, throw an error
            throw new Error(`Handler for ${handlerName} should be a RegExp or a function. Got: ${typeof handler}`);

        }

        this.handlers.push(handler);
    }

    parse(title) {
        title = title.replace(/_+/g, " ");
        const result = {};
        const matched = {};
        let endOfTitle = title.length;

        for (const handler of this.handlers) {
            const matchResult = handler({ title, result, matched });
            if (matchResult && matchResult.remove) {
                title = title.slice(0, matchResult.matchIndex) + title.slice(matchResult.matchIndex + matchResult.rawMatch.length);
            }
            if (matchResult && !matchResult.skipFromTitle && matchResult.matchIndex && matchResult.matchIndex < endOfTitle) {
                endOfTitle = matchResult.matchIndex;
            }
            if (matchResult && matchResult.remove && matchResult.skipFromTitle && matchResult.matchIndex < endOfTitle) {

                // adjust title index in case part of it should be removed and skipped
                endOfTitle -= matchResult.rawMatch.length;
            }
        }

        result.title = cleanTitle(title.slice(0, endOfTitle));

        return result;
    }
}

exports.Parser = Parser;
