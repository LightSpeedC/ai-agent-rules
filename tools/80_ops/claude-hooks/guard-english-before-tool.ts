// PreToolUse フック: ツールを呼ぶ前に、直前の文が英語だけなら止める（課題 i261029-01）。
// Stop フック（require-japanese.ts）は応答を終えた後に見るため、ツールの前の 1 行の英語は、ターンの最後まで見つからなかった。
// 英語の行が画面に出るのは防げない。変わるのは、気づくのがその場になることと、英語のまま作業を進めないこと。
// 見るのは、直前のツールの結果（無ければ利用者の発言）より後のテキストだけ。止めた後に日本語で書けば、次の呼び出しは通る。
// 前のツールのときに読めなかった英文は、1 度猶予してから止める (決定 445-A)。訳済みは、英文のあとに英語だけでないかたまりがあるかで見る (決定 446-A)。
// 会話ログが読めないときは通す（フックの不具合で作業を止めない）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readFileSync } from 'node:fs';
import { recordDeny } from './english-deny-log.ts';
import { isEnglishOnly, isGraced, markEnglish, markGrace, quoteEnglish, routedTextsSinceLastToolResult, unmarked, untranslated } from './japanese-check.ts';
import { readInput } from './vault.ts';

const input = await readInput();
if (!input.transcript_path) process.exit(0);

const toolUseId = (input as { tool_use_id?: string }).tool_use_id;
let jsonl: string;
let routed: ReturnType<typeof routedTextsSinceLastToolResult>;
try {
	jsonl = readFileSync(input.transcript_path, 'utf8');
	routed = routedTextsSinceLastToolResult(jsonl, toolUseId);
} catch {
	process.exit(0);
}
// 一度止めた英文は、もう止めない (決定 420-A)。止めるときに印を付ける
const english = untranslated(unmarked(input.transcript_path, routed.map((item) => item.text))).filter(isEnglishOnly);
if (english.length === 0) process.exit(0);
// 前のツールのときに読めなかった英文 (previous・pending) は、1 度猶予して印を付ける (決定 445-A)。
// 直前の訳は、この時点の会話ログに無いことがある。次のツールで、まだ訳済みが見えなければ止める。
// 直前 (parts) に書いた英文は、これから訳を書く文なので、猶予しない
const justWritten = (text: string) => routed.some((item) => item.route === 'parts' && item.text === text);
let grace = english.filter((text) => !justWritten(text) && !isGraced(input.transcript_path!, text));
// 印を置けなければ猶予しない (毎回猶予になり、止まらなくなるため)
if (!markGrace(input.transcript_path, grace)) grace = [];
const texts = english.filter((text) => !grace.includes(text));
// 猶予した回も残す。猶予が何回働いたかと、そのとき訳が見えていたかを、あとで数えるため
if (grace.length > 0) recordDeny({ transcriptPath: input.transcript_path, toolUseId, jsonl, texts: routed, denied: grace, kind: 'grace' });
if (texts.length === 0) process.exit(0);
// 止めた時点のログの様子を残す (決定 441-A)。残せなくても止める
recordDeny({ transcriptPath: input.transcript_path, toolUseId, jsonl, texts: routed, denied: texts });
markEnglish(input.transcript_path, texts);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: '直前の文が英語だけです: ' + quoteEnglish(texts) + '。その文の日本語訳を本文に書いてから、もう一度呼んでください（共通ルール「言語表記」の「AIエージェント応答の言語」）。',
	},
}));
