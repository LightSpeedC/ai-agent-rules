// 応答が英語だけかどうかの判定と、会話ログ（JSONL）から最後の応答を取り出す処理。
// 共通ルール「言語表記」（応答は常に日本語）を機械的に確かめるために使う（課題 p261021-01）。
// 判定の基準は課題 i261031-01 の 3-A（コードの部分を除き、日本語の字と英語の語の数を比べる）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// 英字を含むコードの部分。判定の前に除く（コマンドや識別子を、英語の語として数えないため）（課題 i261031-01）。
// 記号 1 つでかたまり全体を外す作りは、Markdown で書いた英文の多くを通したため、やめた。
// Markdown の記法（** # - > |）は英字を含まないので、除かなくても数に影響しない。
const CODE_PARTS = [
	// コードブロック（閉じていなければ末尾まで）。CommonMark と同じく、閉じは行頭から 3 字以内の空白の後に ``` だけの行。
	// 貼った diff の中のフェンス（+ や言語名が付く）を閉じとみなすと、組がずれて日本語の部分まで除くため
	/^ {0,3}```.*$[\s\S]*?(^ {0,3}```[ \t]*$|(?![\s\S]))/gm,
	/`[^`\n]*`/g, // コードスパン
	/[a-z][a-z0-9+.-]*:\/\/\S+/gi, // URL
	/\S*[\\/]\S*/g, // パス（/ か \ を含む語）
];

// かな（ひらがな・カタカナ・半角カタカナ）と漢字
const JAPANESE = /[぀-ヿㇰ-ㇿｦ-ﾟ㐀-䶿一-鿿]/g;

// 英語の語。英字 2 字以上の並び（a・I は数えない）
const ENGLISH_WORD = /[A-Za-z]{2,}/g;

// 英字の数が、この字数以上なら英語とみなしうる（短い固有名詞や略語だけの応答を、誤って止めないため）
const MIN_ENGLISH_LETTERS = 20;

// コードの部分を除いた後、日本語の字の数が英語の語の数より少なければ英語とみなす（3-A）。
// 日本語の文は 1 語に何字も使うので、識別子の多い日本語の応答でも日本語の字が上回る。
export function isEnglishOnly(text: string): boolean {
	let prose = text;
	for (const part of CODE_PARTS) prose = prose.replace(part, ' ');
	const letters = prose.match(/[A-Za-z]/g)?.length ?? 0;
	if (letters < MIN_ENGLISH_LETTERS) return false;
	const japanese = prose.match(JAPANESE)?.length ?? 0;
	const words = prose.match(ENGLISH_WORD)?.length ?? 0;
	return japanese < words;
}

// 会話ログ（JSONL の中身）から、最後の応答のテキストを、かたまりごとに取り出す。
// 応答は、テキストのかたまりごとに別の行として記録される。かたまりを連ねると、途中の英語が日本語に隠れるため、別々に返す。
// 利用者の発言（テキストを含む user の行）で区切り、その後のアシスタントのテキストを集める。
// ツールの結果（tool_result だけの user の行）は区切りにならない。
export function lastTurnTexts(jsonl: string): string[] {
	let parts: string[] = [];
	for (const line of jsonl.split(/\r?\n/)) {
		if (line.trim() === '') continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const message = entry?.message;
		if (!message) continue;
		const content = message.content;
		if (message.role === 'user') {
			const hasUserText = typeof content === 'string' || (Array.isArray(content) && content.some((block: any) => block?.type === 'text'));
			if (hasUserText) parts = [];
		} else if (message.role === 'assistant' && Array.isArray(content)) {
			for (const block of content) {
				if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
			}
		}
	}
	return parts;
}

// 会話ログから、直前のツールの結果（無ければ利用者の発言）より後のテキストを、かたまりごとに取り出す（課題 i261029-01）。
// PreToolUse で使う。いま呼ぶツールの呼び出しがログに書かれているかどうかに左右されないよう、区切りはツールの結果にする。
// currentToolUseId を渡すと、それ以外のツールの呼び出しでも区切る (課題 i261031-08)。
// 新しいツールを呼べている時点で、前のツールは終わっていて、その前の文はそのツールのときに判定が済んでいる。
// 前のツールの結果がログに書かれる前にフックが動いても、前の英語の文で止めない。
// さらに、1 つ前のツールが通っていれば (結果がエラーでなければ)、そのツールの前に書いた文も返す (振り返り r261111-01 の 14-A)。
// ツールの前のフックが動く時点では、同じ応答の文がまだ記録に書かれていない (2026-11-11 に実測)。前のツールのときに読めなかった文を、次のツールで読む。
// 1 つ前のツールをフックが止めていれば (結果がエラー)、その前の文は判定が済んでいるので返さない。
export function textsSinceLastToolResult(jsonl: string, currentToolUseId?: string): string[] {
	let parts: string[] = [];
	let pending: string[] = []; // 前のツールの呼び出しより前の文。結果が通れば previous に移る
	let previous: string[] = []; // 1 つ前のツールが通ったとき、そのツールの前に書いた文
	for (const line of jsonl.split(/\r?\n/)) {
		if (line.trim() === '') continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const message = entry?.message;
		if (!message) continue;
		const content = message.content;
		if (message.role === 'user') {
			const results = Array.isArray(content) ? content.filter((block: any) => block?.type === 'tool_result') : [];
			const hasUserText = typeof content === 'string' || (Array.isArray(content) && content.some((block: any) => block?.type === 'text'));
			if (currentToolUseId && results.length > 0 && !hasUserText) {
				previous = results.some((block: any) => block.is_error) ? [] : [...pending, ...parts];
			} else {
				previous = [];
			}
			pending = [];
			parts = [];
		} else if (message.role === 'assistant' && Array.isArray(content)) {
			for (const block of content) {
				if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
				else if (currentToolUseId && block?.type === 'tool_use' && block.id !== currentToolUseId) {
					pending = [...pending, ...parts];
					parts = [];
				}
			}
		}
	}
	// pending (結果がまだ書かれていない前のツールより前の文) も返す (決定 420-A)。前のツールのときに記録に無かった英文を、ここで読む。
	// 前のツールが止めた文を 2 度止めないのは、印 (markedEnglish) で受け持つ (i261031-08)
	return [...previous, ...pending, ...parts];
}

// 止めた英文の印 (決定 420-A)。セッションの記録ごとに、一時フォルダへ文のハッシュを 1 行ずつ置く (CLAUDE_ENGLISH_MARK_DIR で差し替えられる)。
// ツールの前のフックが止めて訳を書かせた文で、次のツールやターンの終わりに、もう一度止めないために使う
function markFile(transcriptPath: string): string {
	const dir = process.env.CLAUDE_ENGLISH_MARK_DIR || join(tmpdir(), 'claude-english-marks');
	return join(dir, basename(transcriptPath) + '.txt');
}

function markKey(text: string): string {
	return createHash('sha1').update(text.trim().replace(/\s+/g, ' ')).digest('hex');
}

// 印の無い文だけを返す。印が読めなければ、全部を返す
export function unmarked(transcriptPath: string, texts: string[]): string[] {
	let marks: Set<string>;
	try {
		marks = new Set(readFileSync(markFile(transcriptPath), 'utf8').split(/\r?\n/));
	} catch {
		return texts;
	}
	return texts.filter((text) => !marks.has(markKey(text)));
}

// 英語だけの文に印を付ける。置けなくても止めない (次に 2 度止めることがあるだけ)
export function markEnglish(transcriptPath: string, texts: string[]): void {
	const keys = texts.filter(isEnglishOnly).map(markKey);
	if (keys.length === 0) return;
	try {
		const file = markFile(transcriptPath);
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, keys.join('\n') + '\n');
	} catch {
		// 印を置けないだけ
	}
}

// 英語だけのかたまりを「」で囲んで並べる。止めるときの理由に添え、どの文かを探し直さずに済むようにする (課題 i261111-04)。
// 長いかたまりは、先頭の 80 字までにして … を付ける
const QUOTE_MAX = 80;
export function quoteEnglish(texts: string[]): string {
	return texts
		.filter(isEnglishOnly)
		.map((text) => {
			const line = text.trim().replace(/\s+/g, ' ');
			return '「' + (line.length > QUOTE_MAX ? line.slice(0, QUOTE_MAX) + '…' : line) + '」';
		})
		.join(' ');
}

// 最後の応答の本文を、1 つの文字列にする（判定の単位ではなく、表示や確かめに使う）
export function lastAssistantText(jsonl: string): string {
	return lastTurnTexts(jsonl).join('');
}
