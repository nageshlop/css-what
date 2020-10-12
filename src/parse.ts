export interface Options {
    /**
     * When false, tag names will not be lowercased.
     * @default true
     */
    lowerCaseAttributeNames?: boolean;
    /**
     * When false, attribute names will not be lowercased.
     * @default true
     */
    lowerCaseTags?: boolean;
    /**
     * When `true`, `xmlMode` implies both `lowerCaseTags` and `lowerCaseAttributeNames` are set to `false`.
     * @default false
     */
    xmlMode?: boolean;
}

export type Selector =
    | PseudoSelector
    | PseudoElement
    | AttributeSelector
    | TagSelector
    | UniversalSelector
    | Traversal;

export interface AttributeSelector {
    type: "attribute";
    name: string;
    action: AttributeAction;
    value: string;
    ignoreCase: boolean;
}

type DataType = Selector[][] | null | string;

export interface PseudoSelector {
    type: "pseudo";
    name: string;
    data: DataType;
}

export interface PseudoElement {
    type: "pseudo-element";
    name: string;
}

export interface TagSelector {
    type: "tag";
    name: string;
}

export interface UniversalSelector {
    type: "universal";
}

export interface Traversal {
    type: TraversalType;
}

export type AttributeAction =
    | "any"
    | "element"
    | "end"
    | "equals"
    | "exists"
    | "hyphen"
    | "not"
    | "start";

export type TraversalType =
    | "adjacent"
    | "child"
    | "descendant"
    | "parent"
    | "sibling";

const reName = /^[^\\]?(?:\\(?:[\da-f]{1,6}\s?|.)|[\w\-\u00b0-\uFFFF])+/;
const reEscape = /\\([\da-f]{1,6}\s?|(\s)|.)/gi;
// Modified version of https://github.com/jquery/sizzle/blob/master/src/sizzle.js#L87
const reAttr = /^\s*((?:\\.|[\w\u00b0-\uFFFF-])+)\s*(?:(\S?)=\s*(?:(['"])((?:[^\\]|\\[^])*?)\3|(#?(?:\\.|[\w\u00b0-\uFFFF-])*)|)|)\s*(i)?\]/;

const actionTypes: { [key: string]: AttributeAction } = {
    undefined: "exists",
    "": "equals",
    "~": "element",
    "^": "start",
    $: "end",
    "*": "any",
    "!": "not",
    "|": "hyphen",
};

const Traversals: { [key: string]: TraversalType } = {
    ">": "child",
    "<": "parent",
    "~": "sibling",
    "+": "adjacent",
};

const attribSelectors: { [key: string]: [string, AttributeAction] } = {
    "#": ["id", "equals"],
    ".": ["class", "element"],
};

// Pseudos, whose data property is parsed as well.
const unpackPseudos = new Set([
    "has",
    "not",
    "matches",
    "is",
    "host",
    "host-context",
]);

const traversalNames = new Set<TraversalType>([
    "descendant",
    ...Object.keys(Traversals).map((k) => Traversals[k]),
]);

/**
 * Checks whether a specific selector is a traversal.
 * This is useful eg. in swapping the order of elements that
 * are not traversals.
 *
 * @param selector Selector to check.
 */
export function isTraversal(selector: Selector): selector is Traversal {
    return traversalNames.has(selector.type as TraversalType);
}

const stripQuotesFromPseudos = new Set(["contains", "icontains"]);

const quotes = new Set(['"', "'"]);

// Unescape function taken from https://github.com/jquery/sizzle/blob/master/src/sizzle.js#L152
function funescape(_: string, escaped: string, escapedWhitespace?: string) {
    const high = parseInt(escaped, 16) - 0x10000;

    // NaN means non-codepoint
    return high !== high || escapedWhitespace
        ? escaped
        : high < 0
        ? // BMP codepoint
          String.fromCharCode(high + 0x10000)
        : // Supplemental Plane codepoint (surrogate pair)
          String.fromCharCode((high >> 10) | 0xd800, (high & 0x3ff) | 0xdc00);
}

function unescapeCSS(str: string) {
    return str.replace(reEscape, funescape);
}

function isWhitespace(c: string) {
    return c === " " || c === "\n" || c === "\t" || c === "\f" || c === "\r";
}

/**
 * Parses `selector`, optionally with the passed `options`.
 *
 * @param selector Selector to parse.
 * @param options Options for parsing.
 * @returns Returns a two-dimensional array.
 * The first dimension represents selectors separated by commas (eg. `sub1, sub2`),
 * the second contains the relevant tokens for that selector.
 */
export default function parse(
    selector: string,
    options?: Options
): Selector[][] {
    const subselects: Selector[][] = [];

    selector = parseSelector(subselects, `${selector}`, options);

    if (selector !== "") {
        throw new Error(`Unmatched selector: ${selector}`);
    }

    return subselects;
}

function parseSelector(
    subselects: Selector[][],
    selector: string,
    options: Options = {}
): string {
    let tokens: Selector[] = [];
    let sawWS = false;

    function getName(): string {
        const match = selector.match(reName);

        if (!match) {
            throw new Error(`Expected name, found ${selector}`);
        }

        const [sub] = match;
        selector = selector.substr(sub.length);
        return unescapeCSS(sub);
    }

    function stripWhitespace(start: number) {
        while (isWhitespace(selector.charAt(start))) start++;
        selector = selector.substr(start);
    }

    function isEscaped(pos: number): boolean {
        let slashCount = 0;

        while (selector.charAt(--pos) === "\\") slashCount++;
        return (slashCount & 1) === 1;
    }

    function ensureNotTraversal() {
        if (tokens.length > 0 && isTraversal(tokens[tokens.length - 1])) {
            throw new Error("Did not expect successive traversals.");
        }
    }

    stripWhitespace(0);

    while (selector !== "") {
        const firstChar = selector.charAt(0);

        if (isWhitespace(firstChar)) {
            sawWS = true;
            stripWhitespace(1);
        } else if (firstChar in Traversals) {
            ensureNotTraversal();
            tokens.push({ type: Traversals[firstChar] });
            sawWS = false;

            stripWhitespace(1);
        } else if (firstChar === ",") {
            if (tokens.length === 0) {
                throw new Error("Empty sub-selector");
            }
            subselects.push(tokens);
            tokens = [];
            sawWS = false;
            stripWhitespace(1);
        } else {
            if (sawWS) {
                ensureNotTraversal();
                tokens.push({ type: "descendant" });
                sawWS = false;
            }

            if (firstChar === "*") {
                selector = selector.substr(1);
                tokens.push({ type: "universal" });
            } else if (firstChar in attribSelectors) {
                const [name, action] = attribSelectors[firstChar];
                selector = selector.substr(1);
                tokens.push({
                    type: "attribute",
                    name,
                    action,
                    value: getName(),
                    ignoreCase: false,
                });
            } else if (firstChar === "[") {
                selector = selector.substr(1);
                const attributeMatch = selector.match(reAttr);
                if (!attributeMatch) {
                    throw new Error(
                        `Malformed attribute selector: ${selector}`
                    );
                }

                const [
                    completeSelector,
                    baseName,
                    actionType,
                    ,
                    quotedValue = "",
                    value = quotedValue,
                    ignoreCase,
                ] = attributeMatch;

                selector = selector.substr(completeSelector.length);
                let name = unescapeCSS(baseName);

                if (options.lowerCaseAttributeNames ?? !options.xmlMode) {
                    name = name.toLowerCase();
                }

                tokens.push({
                    type: "attribute",
                    name,
                    action: actionTypes[actionType],
                    value: unescapeCSS(value),
                    ignoreCase: !!ignoreCase,
                });
            } else if (firstChar === ":") {
                if (selector.charAt(1) === ":") {
                    selector = selector.substr(2);
                    tokens.push({
                        type: "pseudo-element",
                        name: getName().toLowerCase(),
                    });
                    continue;
                }

                selector = selector.substr(1);

                const name = getName().toLowerCase();
                let data: DataType = null;

                if (selector.startsWith("(")) {
                    if (unpackPseudos.has(name)) {
                        if (quotes.has(selector.charAt(1))) {
                            throw new Error(
                                `Pseudo-selector ${name} cannot be quoted`
                            );
                        }

                        selector = selector.substr(1);

                        data = [];
                        selector = parseSelector(data, selector, options);

                        if (!selector.startsWith(")")) {
                            throw new Error(
                                `Missing closing parenthesis in :${name} (${selector})`
                            );
                        }

                        selector = selector.substr(1);
                    } else {
                        let pos = 1;
                        let counter = 1;

                        for (; counter > 0 && pos < selector.length; pos++) {
                            if (
                                selector.charAt(pos) === "(" &&
                                !isEscaped(pos)
                            ) {
                                counter++;
                            } else if (
                                selector.charAt(pos) === ")" &&
                                !isEscaped(pos)
                            ) {
                                counter--;
                            }
                        }

                        if (counter) {
                            throw new Error("Parenthesis not matched");
                        }

                        data = selector.substr(1, pos - 2);
                        selector = selector.substr(pos);

                        if (stripQuotesFromPseudos.has(name)) {
                            const quot = data.charAt(0);

                            if (quot === data.slice(-1) && quotes.has(quot)) {
                                data = data.slice(1, -1);
                            }

                            data = unescapeCSS(data);
                        }
                    }
                }

                tokens.push({ type: "pseudo", name, data });
            } else if (reName.test(selector)) {
                let name = getName();

                if (options.lowerCaseTags ?? !options.xmlMode) {
                    name = name.toLowerCase();
                }

                tokens.push({ type: "tag", name });
            } else {
                if (
                    tokens.length &&
                    tokens[tokens.length - 1].type === "descendant"
                ) {
                    tokens.pop();
                }
                addToken(subselects, tokens);
                return selector;
            }
        }
    }

    addToken(subselects, tokens);

    return selector;
}

function addToken(subselects: Selector[][], tokens: Selector[]) {
    if (subselects.length > 0 && tokens.length === 0) {
        throw new Error("Empty sub-selector");
    }

    subselects.push(tokens);
}
