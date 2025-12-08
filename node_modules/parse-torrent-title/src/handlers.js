const { none, value, integer, boolean, lowercase, uppercase, date, range, yearRange, array, uniqConcat } = require("./transformers");

exports.addDefaults = /** @type Parser */ parser => {

    // Episode code
    parser.addHandler("episodeCode", /[[(]([a-z0-9]{8}|[A-Z0-9]{8})[\])](?=\.[a-zA-Z0-9]{1,5}$|$)/, uppercase, { remove: true });
    parser.addHandler("episodeCode", /\[(?=[A-Z]+\d|\d+[A-Z])([A-Z0-9]{8})]/, uppercase, { remove: true });

    // Resolution
    parser.addHandler("resolution", /\b[([]?4k[)\]]?\b/i, value("4k"), { remove: true });
    parser.addHandler("resolution", /21600?[pi]/i, value("4k"), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("resolution", /[([]?3840x\d{4}[)\]]?/i, value("4k"), { remove: true });
    parser.addHandler("resolution", /[([]?1920x\d{3,4}[)\]]?/i, value("1080p"), { remove: true });
    parser.addHandler("resolution", /[([]?1280x\d{3}[)\]]?/i, value("720p"), { remove: true });
    parser.addHandler("resolution", /[([]?\d{3,4}x(\d{3,4})[)\]]?/i, value("$1p"), { remove: true });
    parser.addHandler("resolution", /(480|720|1080)0[pi]/i, value("$1p"), { remove: true });
    parser.addHandler("resolution", /(?:BD|HD|M)(720|1080|2160)/, value("$1p"), { remove: true });
    parser.addHandler("resolution", /(480|576|720|1080|2160)[pi]/i, value("$1p"), { remove: true });
    parser.addHandler("resolution", /(?:^|\D)(\d{3,4})[pi]/i, value("$1p"), { remove: true });

    // Year
    parser.addHandler("date", /(?<=\W|^)([([]?(?:19[6-9]|20[012])[0-9]([. \-/\\])(?:0[1-9]|1[012])\2(?:0[1-9]|[12][0-9]|3[01])[)\]]?)(?=\W|$)/, date("YYYY MM DD"), { remove: true });
    parser.addHandler("date", /(?<=\W|^)([([]?(?:0[1-9]|[12][0-9]|3[01])([. \-/\\])(?:0[1-9]|1[012])\2(?:19[6-9]|20[012])[0-9][)\]]?)(?=\W|$)/, date("DD MM YYYY"), { remove: true });
    parser.addHandler("date", /(?<=\W)([([]?(?:0[1-9]|1[012])([. \-/\\])(?:0[1-9]|[12][0-9]|3[01])\2(?:19[6-9]|20[012])[0-9][)\]]?)(?=\W|$)/, date("MM DD YYYY"), { remove: true });
    parser.addHandler("date", /(?<=\W)([([]?(?:0[1-9]|1[012])([. \-/\\])(?:0[1-9]|[12][0-9]|3[01])\2(?:[0][1-9]|[0126789][0-9])[)\]]?)(?=\W|$)/, date("MM DD YY"), { remove: true });
    parser.addHandler("date", /(?<=\W)([([]?(?:0[1-9]|[12][0-9]|3[01])([. \-/\\])(?:0[1-9]|1[012])\2(?:[0][1-9]|[0126789][0-9])[)\]]?)(?=\W|$)/, date("DD MM YY"), { remove: true });
    parser.addHandler("date", /(?<=\W|^)([([]?(?:0?[1-9]|[12][0-9]|3[01])[. ]?(?:st|nd|rd|th)?([. \-/\\])(?:feb(?:ruary)?|jan(?:uary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\2(?:19[7-9]|20[012])[0-9][)\]]?)(?=\W|$)/i, date("DD MMM YYYY"), { remove: true });
    parser.addHandler("date", /(?<=\W|^)([([]?(?:0?[1-9]|[12][0-9]|3[01])[. ]?(?:st|nd|rd|th)?([. \-/\\])(?:feb(?:ruary)?|jan(?:uary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\2(?:0[1-9]|[0126789][0-9])[)\]]?)(?=\W|$)/i, date("DD MMM YY"), { remove: true });
    parser.addHandler("date", /(?<=\W|^)([([]?20[012][0-9](?:0[1-9]|1[012])(?:0[1-9]|[12][0-9]|3[01])[)\]]?)(?=\W|$)/, date("YYYYMMDD"), { remove: true });

    // Year
    parser.addHandler("year", /[([*]?[ .]?((?:19\d|20[012])\d[ .]?-[ .]?(?:19\d|20[012])\d)(?:\s?[*)\]])?/, yearRange, { remove: true });
    parser.addHandler("year", /[([*][ .]?((?:19\d|20[012])\d[ .]?-[ .]?\d{2})(?:\s?[*)\]])?/, yearRange, { remove: true });
    parser.addHandler("year", /[([*]?(?!^)(?<!\d|Cap[. ]?)((?:19\d|20[012])\d)(?!\d|kbps)[*)\]]?/i, integer, { remove: true });
    parser.addHandler("year", /^[([]?((?:19\d|20[012])\d)(?!\d|kbps)[)\]]?/i, integer, { remove: true });

    // Extended
    parser.addHandler("extended", /EXTENDED/, boolean);
    parser.addHandler("extended", /- Extended/i, boolean);

    // Convert
    parser.addHandler("convert", /CONVERT/, boolean);

    // Hardcoded
    parser.addHandler("hardcoded", /HC|HARDCODED/, boolean);

    // Proper
    parser.addHandler("proper", /(?:REAL.)?PROPER/, boolean);

    // Repack
    parser.addHandler("repack", /REPACK|RERIP/, boolean);

    // Retail
    parser.addHandler("retail", /\bRetail\b/i, boolean);

    // RemasteredREKONSTRUKCJA
    parser.addHandler("remastered", /\bRemaster(?:ed)?\b/i, boolean);
    parser.addHandler("remastered", /\b[[(]?REKONSTRUKCJA[\])]?\b/i, boolean);

    // Unrated
    parser.addHandler("unrated", /\bunrated|uncensored\b/i, boolean);

    // Region
    parser.addHandler("region", /R\d\b/, none, { skipIfFirst: true });

    // Source
    parser.addHandler("source", /\b(?:H[DQ][ .-]*)?CAM(?:H[DQ])?(?:[ .-]*Rip)?\b/i, value("CAM"), { remove: true });
    parser.addHandler("source", /\b(?:H[DQ][ .-]*)?S[ .-]+print/i, value("CAM"), { remove: true });
    parser.addHandler("source", /\b(?:HD[ .-]*)?T(?:ELE)?S(?:YNC)?(?:Rip)?\b/i, value("TeleSync"), { remove: true });
    parser.addHandler("source", /\b(?:HD[ .-]*)?T(?:ELE)?C(?:INE)?(?:Rip)?\b/, value("TeleCine"), { remove: true });
    parser.addHandler("source", /\bBlu[ .-]*Ray\b(?=.*remux)/i, value("BluRay REMUX"), { remove: true });
    parser.addHandler("source", /(?:BD|BR|UHD)[- ]?remux/i, value("BluRay REMUX"), { remove: true });
    parser.addHandler("source", /(?<=remux.*)\bBlu[ .-]*Ray\b/i, value("BluRay REMUX"), { remove: true });
    parser.addHandler("source", /\bBlu[ .-]*Ray\b(?![ .-]*Rip)/i, value("BluRay"), { remove: true });
    parser.addHandler("source", /\bUHD[ .-]*Rip\b/i, value("UHDRip"), { remove: true });
    parser.addHandler("source", /\bHD[ .-]*Rip\b/i, value("HDRip"), { remove: true });
    parser.addHandler("source", /\bMicro[ .-]*HD\b/i, value("HDRip"), { remove: true });
    parser.addHandler("source", /\b(?:BR|Blu[ .-]*Ray)[ .-]*Rip\b/i, value("BRRip"), { remove: true });
    parser.addHandler("source", /\bBD[ .-]*Rip\b|\bBDR\b|\bBD-RM\b|[[(]BD[\]) .,-]/i, value("BDRip"), { remove: true });
    parser.addHandler("source", /\b(?:HD[ .-]*)?DVD[ .-]*Rip\b/i, value("DVDRip"), { remove: true });
    parser.addHandler("source", /\bVHS[ .-]*Rip\b/i, value("DVDRip"), { remove: true });
    parser.addHandler("source", /\b(?:DVD?|BD|BR)?[ .-]*Scr(?:eener)?\b/i, value("SCR"), { remove: true });
    parser.addHandler("source", /\bP(?:re)?DVD(?:Rip)?\b/i, value("SCR"), { remove: true });
    parser.addHandler("source", /\bDVD(?:R\d?)?\b/i, value("DVD"), { remove: true });
    parser.addHandler("source", /\bVHS\b/i, value("DVD"), { remove: true, skipIfFirst: true });
    parser.addHandler("source", /\bPPVRip\b/i, value("PPVRip"), { remove: true });
    parser.addHandler("source", /\bHD[ .-]*TV(?:Rip)?\b/i, value("HDTV"), { remove: true });
    parser.addHandler("source", /\bDVB[ .-]*(?:Rip)?\b/i, value("HDTV"), { remove: true });
    parser.addHandler("source", /\bSAT[ .-]*Rips?\b/i, value("SATRip"), { remove: true });
    parser.addHandler("source", /\bTVRips?\b/i, value("TVRip"), { remove: true });
    parser.addHandler("source", /\bR5\b/i, value("R5"), { remove: true });
    parser.addHandler("source", /\bWEB[ .-]*DL(?:Rip)?\b/i, value("WEB-DL"), { remove: true });
    parser.addHandler("source", /\bWEB[ .-]*Rip\b/i, value("WEBRip"), { remove: true });
    parser.addHandler("source", /\b(?:DL|WEB|BD|BR)MUX\b/i, { remove: true });
    parser.addHandler("source", /\b(DivX|XviD)\b/, { remove: true });

    // Video depth
    parser.addHandler("bitDepth", /(?:8|10|12)[- ]?bit/i, lowercase, { remove: true });
    parser.addHandler("bitDepth", /\bhevc\s?10\b/i, value("10bit"));
    parser.addHandler("bitDepth", /\bhdr10\b/i, value("10bit"));
    parser.addHandler("bitDepth", /\bhi10\b/i, value("10bit"));
    parser.addHandler("bitDepth", ({ result }) => {
        if (result.bitDepth) {
            result.bitDepth = result.bitDepth.replace(/[ -]/, "");
        }
    });

    // HDR
    parser.addHandler("hdr", /\bDV\b|dolby.?vision|\bDoVi\b/i, uniqConcat(value("DV")), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("hdr", /HDR10(?:\+|plus)/i, uniqConcat(value("HDR10+")), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("hdr", /\bHDR(?:10)?\b/i, uniqConcat(value("HDR")), { remove: true, skipIfAlreadyFound: false });

    // 3D
    parser.addHandler("threeD", /\b(3D)\b.*\b(Half-?SBS|H[-\\/]?SBS)\b/i, value("3D HSBS"));
    parser.addHandler("threeD", /\bHalf.Side.?By.?Side\b/i, value("3D HSBS"));
    parser.addHandler("threeD", /\b(3D)\b.*\b(Full-?SBS|SBS)\b/i, value("3D SBS"));
    parser.addHandler("threeD", /\bSide.?By.?Side\b/i, value("3D SBS"));
    parser.addHandler("threeD", /\b(3D)\b.*\b(Half-?OU|H[-\\/]?OU)\b/i, value("3D HOU"));
    parser.addHandler("threeD", /\bHalf.?Over.?Under\b/i, value("3D HOU"));
    parser.addHandler("threeD", /\b(3D)\b.*\b(OU)\b/i, value("3D OU"));
    parser.addHandler("threeD", /\bOver.?Under\b/i, value("3D OU"));
    parser.addHandler("threeD", /\b((?:BD)?3D)\b/i, value("3D"), { skipIfFirst: true });

    // Codec
    parser.addHandler("codec", /\b[xh][-. ]?26[45]/i, lowercase, { remove: true });
    parser.addHandler("codec", /\bhevc(?:\s?10)?\b/i, value("hevc"), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("codec", /\b(?:dvix|mpeg2|divx|xvid|avc)\b/i, lowercase, { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("codec", ({ result }) => {
        if (result.codec) {
            result.codec = result.codec.replace(/[ .-]/, "");
        }
    });

    // Audio
    parser.addHandler("audio", /7\.1[. ]?Atmos\b/i, value("7.1 Atmos"), { remove: true });
    parser.addHandler("audio", /\b(?:mp3|Atmos|DTS(?:-HD)?|TrueHD)\b/i, lowercase);
    parser.addHandler("audio", /\bFLAC(?:\+?2\.0)?(?:x[2-4])?\b/i, value("flac"), { remove: true });
    parser.addHandler("audio", /\bEAC-?3(?:[. -]?[256]\.[01])?/i, value("eac3"), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("audio", /\bAC-?3(?:[.-]5\.1|x2\.?0?)?\b/i, value("ac3"), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("audio", /\b5\.1(?:x[2-4]+)?\+2\.0(?:x[2-4])?\b/i, value("2.0"), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("audio", /\b2\.0(?:x[2-4]|\+5\.1(?:x[2-4])?)\b/i, value("2.0"), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("audio", /\b5\.1ch\b/i, value("ac3"), { remove: true, skipIfAlreadyFound: false });
    parser.addHandler("audio", /\bDD5[. ]?1\b/i, value("dd5.1"), { remove: true });
    parser.addHandler("audio", /\bQ?AAC(?:[. ]?2[. ]0|x2)?\b/, value("aac"), { remove: true });
    parser.addHandler("audioChannels", /\[[257][.-][01]]/, lowercase, { remove: true });

    // Group
    parser.addHandler("group", /- ?(?!\d+$|S\d+|\d+x|ep?\d+|[^[]+]$)([^\-. []+[^\-. [)\]\d][^\-. [)\]]*)(?:\[[\w.-]+])?(?=\.\w{2,4}$|$)/i, { remove: true });

    // Container
    parser.addHandler("container", /\.?[[(]?\b(MKV|AVI|MP4|WMV|MPG|MPEG)\b[\])]?/i, lowercase);

    // Volumes
    parser.addHandler("volumes", /\bvol(?:s|umes?)?[. -]*(?:\d{1,2}[., +/\\&-]+)+\d{1,2}\b/i, range, { remove: true });
    parser.addHandler("volumes", ({ title, result, matched }) => {
        const startIndex = matched.year && matched.year.matchIndex || 0;
        const match = title.slice(startIndex).match(/\bvol(?:ume)?[. -]*(\d{1,2})/i);

        if (match) {
            matched.volumes = { match: match[0], matchIndex: match.index };
            result.volumes = array(integer)(match[1]);
            return { rawMatch: match[0], matchIndex: match.index, remove: true };
        }
        return null;
    });

    // Season
    parser.addHandler("seasons", /(?:complete\W|seasons?\W|\W|^)((?:s\d{1,2}[., +/\\&-]+)+s\d{1,2}\b)/i, range, { remove: true });
    parser.addHandler("seasons", /(?:complete\W|seasons?\W|\W|^)[([]?(s\d{2,}-\d{2,}\b)[)\]]?/i, range, { remove: true });
    parser.addHandler("seasons", /(?:complete\W|seasons?\W|\W|^)[([]?(s[1-9]-[2-9]\b)[)\]]?/i, range, { remove: true });
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete\W)?(?:seasons?|[Сс]езони?|sezon|temporadas?|stagioni)[. ]?[-:]?[. ]?[([]?((?:\d{1,2}[, /\\&]+)+\d{1,2}\b)[)\]]?/i, range, { remove: true });
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete\W)?(?:seasons|[Сс]езони?|sezon|temporadas?|stagioni)[. ]?[-:]?[. ]?[([]?((?:\d{1,2}[. -]+)+0?[1-9]\d?\b)[)\]]?/i, range, { remove: true });
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete\W)?season[. ]?[([]?((?:\d{1,2}[. -]+)+[1-9]\d?\b)[)\]]?(?!.*\.\w{2,4}$)/i, range, { remove: true });
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete\W)?\bseasons?\b[. -]?(\d{1,2}[. -]?(?:to|thru|and|\+|:)[. -]?\d{1,2})\b/i, range, { remove: true });
    parser.addHandler("seasons", /(\d{1,2})(?:-?й)?[. _]?(?:[Сс]езон|sez(?:on)?)(?:\W?\D|$)/i, array(integer));
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete\W)?(?:saison|seizoen|sezon(?:SO?)?|stagione|season|series|temp(?:orada)?):?[. ]?(\d{1,2})/i, array(integer));
    parser.addHandler("seasons", /[Сс]езон:?[. _]?№?(\d{1,2})(?!\d)/i, array(integer));
    parser.addHandler("seasons", /(?:\D|^)(\d{1,2})Â?[°ºªa]?[. ]*temporada/i, array(integer), { remove: true });
    parser.addHandler("seasons", /t(\d{1,3})(?:[ex]+|$)/i, array(integer), { remove: true });
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete)?(?:\W|^)so?([01]?[0-5]?[1-9])(?:[\Wex]|\d{2}\b)/i, array(integer), { skipIfAlreadyFound: false });
    parser.addHandler("seasons", /(?:so?|t)(\d{1,2})[. ]?[xх-]?[. ]?(?:e|x|х|ep|-|\.)[. ]?\d{1,4}(?:[abc]|v0?[1-4]|\D|$)/i, array(integer));
    parser.addHandler("seasons", /(?:(?:\bthe\W)?\bcomplete\W)?(?:\W|^)(\d{1,2})[. ]?(?:st|nd|rd|th)[. ]*season/i, array(integer));
    parser.addHandler("seasons", /(?:\D|^)(\d{1,2})[Xxх]\d{1,3}(?:\D|$)/, array(integer));
    parser.addHandler("seasons", /\bSn([1-9])(?:\D|$)/, array(integer));
    parser.addHandler("seasons", /[[(](\d{1,2})\.\d{1,3}[)\]]/, array(integer));
    parser.addHandler("seasons", /-\s?(\d{1,2})\.\d{2,3}\s?-/, array(integer));
    parser.addHandler("seasons", /(?:^|\/)(?!20-20)(\d{1,2})-\d{2}\b(?!-\d)/, array(integer));
    parser.addHandler("seasons", /[^\w-](\d{1,2})-\d{2}(?=\.\w{2,4}$)/, array(integer));
    parser.addHandler("seasons", /(?<!\bEp?(?:isode)? ?\d+\b.*)\b(\d{2})[ ._]\d{2}(?:.F)?\.\w{2,4}$/, array(integer));
    parser.addHandler("seasons", /\bEp(?:isode)?\W+(\d{1,2})\.\d{1,3}\b/i, array(integer));

    // adds single season info if its there"s only single season
    parser.addHandler("season", ({ result }) => {
        if (result.seasons && result.seasons.length === 1) {
            result.season = result.seasons[0];
        }
    });

    // Episode
    parser.addHandler("episodes", /(?:[\W\d]|^)e[ .]?[([]?(\d{1,3}(?:[ .-]*(?:[&+]|e){1,2}[ .]?\d{1,3})+)(?:\W|$)/i, range);
    parser.addHandler("episodes", /(?:[\W\d]|^)ep[ .]?[([]?(\d{1,3}(?:[ .-]*(?:[&+]|ep){1,2}[ .]?\d{1,3})+)(?:\W|$)/i, range);
    parser.addHandler("episodes", /(?:[\W\d]|^)\d+[xх][ .]?[([]?(\d{1,3}(?:[ .]?[xх][ .]?\d{1,3})+)(?:\W|$)/i, range);
    parser.addHandler("episodes", /(?:[\W\d]|^)(?:episodes?|[Сс]ерии:?)[ .]?[([]?(\d{1,3}(?:[ .+]*[&+][ .]?\d{1,3})+)(?:\W|$)/i, range);
    parser.addHandler("episodes", /[([]?(?:\D|^)(\d{1,3}[ .]?ao[ .]?\d{1,3})[)\]]?(?:\W|$)/i, range);
    parser.addHandler("episodes", /(?:[\W\d]|^)(?:e|eps?|episodes?|[Сс]ерии:?|\d+[xх])[ .]*[([]?(\d{1,3}(?:-\d{1,3})+)(?:\W|$)/i, range);
    parser.addHandler("episodes", /(?:so?|t)\d{1,2}[. ]?[xх-]?[. ]?(?:e|x|х|ep|-|\.)[. ]?(\d{1,4})(?:[abc]|v0?[1-4]|\D|$)/i, array(integer));
    parser.addHandler("episodes", /\b(?:so?|t)\d{2}(\d{2})\b/i, array(integer));
    parser.addHandler("episodes", /(?:\W|^)(\d{1,3}(?:[ .]*~[ .]*\d{1,3})+)(?:\W|$)/i, range);
    parser.addHandler("episodes", /-\s(\d{1,3}[ .]*-[ .]*\d{1,3})(?!-\d)(?:\W|$)/i, range);
    parser.addHandler("episodes", /s\d{1,2}\s?\((\d{1,3}[ .]*-[ .]*\d{1,3})\)/i, range);
    parser.addHandler("episodes", /(?:^|\/)(?!20-20)\d{1,2}-(\d{2})\b(?!-\d)/, array(integer));
    parser.addHandler("episodes", /(?<!\d-)\b\d{1,2}-(\d{2})(?=\.\w{2,4}$)/, array(integer));
    parser.addHandler("episodes", /(?<=^\[.+].+)[. ]+-[. ]+(\d{1,4})[. ]+(?=\W)/i, array(integer));
    parser.addHandler("episodes", /(?<!(?:seasons?|[Сс]езони?)\W*)(?:[ .([-]|^)(\d{1,3}(?:[ .]?[,&+~][ .]?\d{1,3})+)(?:[ .)\]-]|$)/i, range);
    parser.addHandler("episodes", /(?<!(?:seasons?|[Сс]езони?)\W*)(?!20-20)(?:[ .([-]|^)(\d{1,3}(?:-\d{1,3})+)(?:[ .)(\]]|-\D|$)/i, range);
    parser.addHandler("episodes", /\bEp(?:isode)?\W+\d{1,2}\.(\d{1,3})\b/i, array(integer));
    parser.addHandler("episodes", /(?:\b[ée]p?(?:isode)?|[Ээ]пизод|[Сс]ер(?:ии|ия|\.)?|caa?p(?:itulo)?|epis[oó]dio)[. ]?[-:#№]?[. ]?(\d{1,4})(?:[abc]|v0?[1-4]|\W|$)/i, array(integer));
    parser.addHandler("episodes", /\b(\d{1,3})(?:-?я)?[ ._-]*(?:ser(?:i?[iyj]a|\b)|[Сс]ер(?:ии|ия|\.)?)/i, array(integer));
    parser.addHandler("episodes", /(?:\D|^)\d{1,2}[. ]?[Xxх][. ]?(\d{1,3})(?:[abc]|v0?[1-4]|\D|$)/, array(integer));
    parser.addHandler("episodes", /[[(]\d{1,2}\.(\d{1,3})[)\]]/, array(integer));
    parser.addHandler("episodes", /\b[Ss](?:eason\W?)?\d{1,2}[ .](\d{1,2})\b/, array(integer));
    parser.addHandler("episodes", /-\s?\d{1,2}\.(\d{2,3})\s?-/, array(integer));
    parser.addHandler("episodes", /(?<=\D|^)(\d{1,3})[. ]?(?:of|из|iz)[. ]?\d{1,3}(?=\D|$)/i, array(integer));
    parser.addHandler("episodes", /\b\d{2}[ ._-](\d{2})(?:.F)?\.\w{2,4}$/, array(integer));
    parser.addHandler("episodes", /(?<!^)\[(\d{2,3})](?!(?:\.\w{2,4})?$)/, array(integer));

    // can be both absolute episode and season+episode in format 101
    parser.addHandler("episodes", ({ title, result, matched }) => {
        if (!result.episodes) {
            const startIndexes = [matched.year, matched.seasons]
                .filter(component => component)
                .map(component => component.matchIndex)
                .filter(index => index > 0);
            const endIndexes = [matched.resolution, matched.source, matched.codec, matched.audio]
                .filter(component => component)
                .map(component => component.matchIndex)
                .filter(index => index > 0);
            const startIndex = startIndexes.length ? Math.min(...startIndexes) : 0;
            const endIndex = Math.min(...endIndexes, title.length);
            const beginningTitle = title.slice(0, endIndex);
            const middleTitle = title.slice(startIndex, endIndex);

            // try to match the episode inside the title with a separator, if not found include the start of the title as well
            const matches = Array.from(beginningTitle.matchAll(/(?<!movie\W*|film\W*|^)(?:[ .]+-[ .]+|[([][ .]*)(\d{1,4})(?:a|b|v\d|\.\d)?(?:\W|$)(?!movie|film|\d+)/gi)).pop() ||
                middleTitle.match(/^(?:[([-][ .]?)?(\d{1,4})(?:a|b|v\d)?(?!\Wmovie|\Wfilm|-\d)(?:\W|$)/i);

            if (matches) {
                result.episodes = [matches[matches.length - 1]]
                    .map(group => group.replace(/\D/g, ""))
                    .map(group => parseInt(group, 10));
                return { matchIndex: title.indexOf(matches[0]) };
            }
        }
        return null;
    });

    // adds single season info if its there's only single season
    parser.addHandler("episode", ({ result }) => {
        if (result.episodes && result.episodes.length === 1) {
            result.episode = result.episodes[0];
        }
    });

    parser.addHandler("complete", /(?:\bthe\W)?(?:\bcomplete|collection|dvd)?\b[ .]?\bbox[ .-]?set\b/i, boolean);
    parser.addHandler("complete", /(?:\bthe\W)?(?:\bcomplete|collection|dvd)?\b[ .]?\bmini[ .-]?series\b/i, boolean);
    parser.addHandler("complete", /(?:\bthe\W)?(?:\bcomplete|full|all)\b.*\b(?:series|seasons|collection|episodes|set|pack|movies)\b/i, boolean);
    parser.addHandler("complete", /\b(?:series|seasons|movies?)\b.*\b(?:complete|collection)\b/i, boolean);
    parser.addHandler("complete", /(?:\bthe\W)?\bultimate\b[ .]\bcollection\b/i, boolean, { skipIfAlreadyFound: false });
    parser.addHandler("complete", /\bcollection\b.*\b(?:set|pack|movies)\b/i, boolean);
    parser.addHandler("complete", /\b(collection|completa)\b/i, boolean, { skipFromTitle: true });
    parser.addHandler("complete", /\bkolekcja\b(?:\Wfilm(?:y|ów|ow)?)?/i, boolean, { remove: true });
    parser.addHandler("complete", /duology|trilogy|quadr[oi]logy|tetralogy|pentalogy|hexalogy|heptalogy|anthology|saga/i, boolean, { skipIfAlreadyFound: false });

    // Language
    parser.addHandler("languages", /\bmulti(?:ple)?[ .-]*(?:su?$|sub\w*|dub\w*)\b|msub/i, uniqConcat(value("multi subs")), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\bmulti(?:ple)?[ .-]*(?:lang(?:uages?)?|audio|VF2)?\b/i, uniqConcat(value("multi audio")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\btri(?:ple)?[ .-]*(?:audio|dub\w*)\b/i, uniqConcat(value("multi audio")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bdual[ .-]*(?:au?$|[aá]udio|line)\b/i, uniqConcat(value("dual audio")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bdual\b(?![ .-]*sub)/i, uniqConcat(value("dual audio")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bengl?(?:sub[A-Z]*)?\b/i, uniqConcat(value("english")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\beng?sub[A-Z]*\b/i, uniqConcat(value("english")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bing(?:l[eéê]s)?\b/i, uniqConcat(value("english")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\benglish\W+(?:subs?|sdh|hi)\b/i, uniqConcat(value("english")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bEN\b/i, uniqConcat(value("english")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\benglish?\b/i, uniqConcat(value("english")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:JP|JAP|JPN)\b/i, uniqConcat(value("japanese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(japanese|japon[eê]s)\b/i, uniqConcat(value("japanese")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:KOR|kor[ .-]?sub)\b/i, uniqConcat(value("korean")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(korean|coreano)\b/i, uniqConcat(value("korean")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:traditional\W*chinese|chinese\W*traditional)(?:\Wchi)?\b/i, uniqConcat(value("taiwanese")), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\bzh-hant\b/i, uniqConcat(value("taiwanese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:mand[ae]rin|ch[sn])\b/i, uniqConcat(value("chinese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bCH[IT]\b/, uniqConcat(value("chinese")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(chinese|chin[eê]s|chi)\b/i, uniqConcat(value("chinese")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bzh-hans\b/i, uniqConcat(value("chinese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bFR(?:ench|a|e|anc[eê]s)?\b/i, uniqConcat(value("french")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(Truefrench|VF[FI])\b/i, uniqConcat(value("french")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(VOST(?:FR?|A)?|SUBFRENCH)\b/i, uniqConcat(value("french")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bspanish\W?latin|american\W*(?:spa|esp?)/i, uniqConcat(value("latino")), { skipFromTitle: true, skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\b(?:audio.)?lat(?:i|ino)?\b/i, uniqConcat(value("latino")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:audio.)?(?:ESP|spa|(en[ .]+)?espa[nñ]ola?|castellano)\b/i, uniqConcat(value("spanish")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bes(?=[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})\b/i, uniqConcat(value("spanish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?<=[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})es\b/i, uniqConcat(value("spanish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?<=[ .,/-]+[A-Z]{2}[ .,/-]+)es(?=[ .,/-]+[A-Z]{2}[ .,/-]+)\b/i, uniqConcat(value("spanish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bes(?=\.(?:ass|ssa|srt|sub|idx)$)/i, uniqConcat(value("spanish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bspanish\W+subs?\b/i, uniqConcat(value("spanish")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(spanish|espanhol)\b/i, uniqConcat(value("spanish")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:p[rt]|en|port)[. (\\/-]*BR\b/i, uniqConcat(value("portuguese")), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\bbr(?:a|azil|azilian)\W+(?:pt|por)\b/i, uniqConcat(value("portuguese")), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\b(?:leg(?:endado|endas?)?|dub(?:lado)?|portugu[eèê]se?)[. -]*BR\b/i, uniqConcat(value("portuguese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bleg(?:endado|endas?)\b/i, uniqConcat(value("portuguese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bportugu[eèê]s[ea]?\b/i, uniqConcat(value("portuguese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bPT[. -]*(?:PT|ENG?|sub(?:s|titles?))\b/i, uniqConcat(value("portuguese")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bpt(?=\.(?:ass|ssa|srt|sub|idx)$)/i, uniqConcat(value("portuguese")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bpor\b/i, uniqConcat(value("portuguese")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bITA\b/i, uniqConcat(value("italian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?<!w{3}\.\w+\.)IT(?=[ .,/-]+(?:[a-zA-Z]{2}[ .,/-]+){2,})\b/, uniqConcat(value("italian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bit(?=\.(?:ass|ssa|srt|sub|idx)$)/i, uniqConcat(value("italian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bitaliano?\b/i, uniqConcat(value("italian")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bgreek[ .-]*(?:audio|lang(?:uage)?|subs?(?:titles?)?)?\b/i, uniqConcat(value("greek")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:GER|DEU)\b/i, uniqConcat(value("german")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bde(?=[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})\b/i, uniqConcat(value("german")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?<=[ .,/-]+(?:[A-Z]{2}[ .,/-]+){2,})de\b/i, uniqConcat(value("german")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?<=[ .,/-]+[A-Z]{2}[ .,/-]+)de(?=[ .,/-]+[A-Z]{2}[ .,/-]+)\b/i, uniqConcat(value("german")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bde(?=\.(?:ass|ssa|srt|sub|idx)$)/i, uniqConcat(value("german")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(german|alem[aã]o)\b/i, uniqConcat(value("german")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bRUS?\b/i, uniqConcat(value("russian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(russian|russo)\b/i, uniqConcat(value("russian")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bUKR\b/i, uniqConcat(value("ukrainian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bukrainian\b/i, uniqConcat(value("ukrainian")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bhin(?:di)?\b/i, uniqConcat(value("hindi")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:(?<!w{3}\.\w+\.)tel(?!\W*aviv)|telugu)\b/i, uniqConcat(value("telugu")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bt[aâ]m(?:il)?\b/i, uniqConcat(value("tamil")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?<!YTS\.)LT\b/, uniqConcat(value("lithuanian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\blithuanian\b/i, uniqConcat(value("lithuanian")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\blatvian\b/i, uniqConcat(value("latvian")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bestonian\b/i, uniqConcat(value("estonian")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:PLDUB|Dubbing.PL|Lektor.PL|Film.Polski)\b/i, uniqConcat(value("polish")), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\b(?:Napisy.PL|PLSUB(?:BED)?)\b/i, uniqConcat(value("polish")), { skipIfAlreadyFound: false, remove: true });
    parser.addHandler("languages", /\b(?:(?<!w{3}\.\w+\.)PL|pol)\b/i, uniqConcat(value("polish")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(polish|polon[eê]s|polaco)\b/i, uniqConcat(value("polish")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bCZ[EH]?\b/i, uniqConcat(value("czech")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bczech\b/i, uniqConcat(value("czech")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bslo(?:vak|vakian|subs|[\]_)]?\.\w{2,4}$)\b/i, uniqConcat(value("slovakian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bHU\b/, uniqConcat(value("hungarian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bHUN(?:garian)?\b/i, uniqConcat(value("hungarian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bROM(?:anian)?\b/i, uniqConcat(value("romanian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bRO(?=[ .,/-]*(?:[A-Z]{2}[ .,/-]+)*sub)/i, uniqConcat(value("romanian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bbul(?:garian)?\b/i, uniqConcat(value("bulgarian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:srp|serbian)\b/i, uniqConcat(value("serbian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:HRV|croatian)\b/i, uniqConcat(value("croatian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bHR(?=[ .,/-]*(?:[A-Z]{2}[ .,/-]+)*sub)\b/i, uniqConcat(value("croatian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bslovenian\b/i, uniqConcat(value("slovenian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:(?<!w{3}\.\w+\.)NL|dut|holand[eê]s)\b/i, uniqConcat(value("dutch")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bdutch\b/i, uniqConcat(value("dutch")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bflemish\b/i, uniqConcat(value("dutch")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:DK|danska|dansub|nordic)\b/i, uniqConcat(value("danish")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(danish|dinamarqu[eê]s)\b/i, uniqConcat(value("danish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bdan\b(?=.*\.(?:srt|vtt|ssa|ass|sub|idx)$)/i, uniqConcat(value("danish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:(?<!w{3}\.\w+\.)FI|finsk|finsub|nordic)\b/i, uniqConcat(value("finnish")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bfinnish\b/i, uniqConcat(value("finnish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:(?<!w{3}\.\w+\.)SE|swe|swesubs?|sv(?:ensk)?|nordic)\b/i, uniqConcat(value("swedish")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(swedish|sueco)\b/i, uniqConcat(value("swedish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:NOR|norsk|norsub|nordic)\b/i, uniqConcat(value("norwegian")), { skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(norwegian|noruegu[eê]s|bokm[aå]l|nob|nor(?=[\]_)]?\.\w{2,4}$))\b/i, uniqConcat(value("norwegian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:arabic|[aá]rabe|ara)\b/i, uniqConcat(value("arabic")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\barab.*(?:audio|lang(?:uage)?|sub(?:s|titles?)?)\b/i, uniqConcat(value("arabic")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bar(?=\.(?:ass|ssa|srt|sub|idx)$)/i, uniqConcat(value("arabic")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:turkish|tur(?:co)?)\b/i, uniqConcat(value("turkish")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bvietnamese\b|\bvie(?=[\]_)]?\.\w{2,4}$)/i, uniqConcat(value("vietnamese")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bind(?:onesian)?\b/i, uniqConcat(value("indonesian")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(thai|tailand[eê]s)\b/i, uniqConcat(value("thai")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(THA|tha)\b/, uniqConcat(value("thai")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(?:malay|may(?=[\]_)]?\.\w{2,4}$)|(?<=subs?\([a-z,]+)may)\b/i, uniqConcat(value("malay")), { skipIfFirst: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\bheb(?:rew|raico)?\b/i, uniqConcat(value("hebrew")), { skipFromTitle: true, skipIfAlreadyFound: false });
    parser.addHandler("languages", /\b(persian|persa)\b/i, uniqConcat(value("persian")), { skipFromTitle: true, skipIfAlreadyFound: false });

    // infer pt language based on season/episode naming
    parser.addHandler("languages", ({ title, result, matched }) => {
        if (!result.languages || ["portuguese", "spanish"].every(l => !result.languages.includes(l))) {
            if ((matched.episodes && matched.episodes.rawMatch.match(/capitulo|ao/i)) ||
                title.match(/dublado/i)) {
                result.languages = (result.languages || []).concat("portuguese");
            }
        }
        return { matchIndex: 0 };
    });

    // Dubbed
    parser.addHandler("dubbed", /\b(?:DUBBED|dublado|dubbing|DUBS?)\b/i, boolean);
    parser.addHandler("dubbed", ({ result }) => {
        if (result.languages && ["multi audio", "dual audio"].some(l => result.languages.includes(l))) {
            result.dubbed = true;
        }
        return { matchIndex: 0 };
    });

    // Group
    parser.addHandler("group", /^\[([^[\]]+)]/);
    parser.addHandler("group", /\(([\w-]+)\)(?:$|\.\w{2,4}$)/);
    parser.addHandler("group", ({ result, matched }) => {
        if (matched.group && matched.group.rawMatch.match(/^\[.+]$/)) {
            const endIndex = matched.group && matched.group.matchIndex + matched.group.rawMatch.length || 0;

            // remove anime group match if some other parameter is contained in it, since it's a false positive.
            if (Object.keys(matched)
                .some(key => matched[key].matchIndex && matched[key].matchIndex < endIndex)) {
                delete result.group;
            }
        }
        return { matchIndex: 0 };
    });

    // Extension
    parser.addHandler("extension", /\.(3g2|3gp|avi|flv|mkv|mk3d|mov|mp2|mp4|m4v|mpe|mpeg|mpg|mpv|webm|wmv|ogm|divx|ts|m2ts|iso|vob|sub|idx|ttxt|txt|smi|srt|ssa|ass|vtt|nfo|html")$/i, lowercase);
};
