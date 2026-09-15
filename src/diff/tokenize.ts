/**
 * Diff tokenization tuned for Chinese prose.
 *
 * Why this granularity: a word-level tokenizer treats a whole Chinese paragraph
 * as one token, so changing two characters paints the entire paragraph red and
 * green. A pure character-level tokenizer fixes that but shreds Latin words and
 * makes English or pinyin edits unreadable. So:
 *
 *   - each CJK character is its own token;
 *   - a run of Latin letters/digits is one token;
 *   - each newline is its own token, so paragraph structure survives;
 *   - other whitespace collapses into runs;
 *   - every other character — including full-width punctuation — is its own
 *     token, so 。 → ！ shows as a punctuation change instead of being absorbed
 *     into a neighbouring word.
 */

/**
 * Scripts whose characters are compared one at a time. Han covers Chinese;
 * kana are included so mixed Japanese text does not degrade into one long run.
 */
const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";

const TOKEN_PATTERN = new RegExp(
	[
		"\\r\\n", // CRLF stays one token so line endings are never split
		"[\\n\\r]", // a bare newline is its own token
		"[^\\S\\r\\n]+", // spaces and tabs, but never newlines
		`[${CJK}]`, // one CJK character per token
		`(?:(?![${CJK}])[\\p{L}\\p{N}_])+`, // Latin/digit words, CJK excluded
		"[\\s\\S]", // anything else: punctuation, symbols, emoji
	].join("|"),
	"gu",
);

/**
 * Split text into diff tokens. Concatenating the result reproduces the input
 * exactly — the tokenizer is lossless, which is what makes it safe to rebuild
 * manuscript text from diff output.
 */
export function tokenize(text: string): string[] {
	if (text.length === 0) return [];
	return text.match(TOKEN_PATTERN) ?? [];
}

/** True when the token is a line break. Used to keep paragraphs visible. */
export function isNewlineToken(token: string): boolean {
	return token === "\n" || token === "\r" || token === "\r\n";
}
