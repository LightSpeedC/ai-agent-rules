// 応答が英語だけかどうかの判定と、会話ログ（JSONL）から最後の応答を取り出す処理。
// 共通ルール「言語表記」（応答は常に日本語）を機械的に確かめるために使う（課題 p261021-01）。
// 判定の基準は、直接の決めごと（依頼どおり）。コードとみなす記号は次のとおり。
//   " ` [ ] { } < > = + * % # / @
// コロン（:）とセミコロン（;）は英文でも使うため、コードとはみなさない。
// ‘ , . - ( ) は、コードとはみなさない。
// node でも bun でも動くよう、標準モジュールだけで書く。

// 記号を 1 つでも含めばコードとみなす（コマンドや識別子を英語として書き直させないため）
const CODE_SYMBOLS = /["`\[\]{}<>=+*%#/@]/;

// かな（ひらがな・カタカナ・半角カタカナ）と漢字
const JAPANESE = /[぀-ヿㇰ-ㇿｦ-ﾟ㐀-䶿一-鿿]/;

// 英字の数が、この字数以上なら英語とみなす（短い固有名詞や略語だけの応答を、誤って止めないため）
const MIN_ENGLISH_LETTERS = 20;

export function isEnglishOnly(text: string): boolean {
	if (CODE_SYMBOLS.test(text)) return false;
	if (JAPANESE.test(text)) return false;
	const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
	return letters >= MIN_ENGLISH_LETTERS;
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

// 最後の応答の本文を、1 つの文字列にする（判定の単位ではなく、表示や確かめに使う）
export function lastAssistantText(jsonl: string): string {
	return lastTurnTexts(jsonl).join('');
}
