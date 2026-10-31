// PreToolUse フック: ツールを呼ぶ前に、直前の文が英語だけなら止める（課題 i261029-01）。
// Stop フック（require-japanese.ts）は応答を終えた後に見るため、ツールの前の 1 行の英語は、ターンの最後まで見つからなかった。
// 英語の行が画面に出るのは防げない。変わるのは、気づくのがその場になることと、英語のまま作業を進めないこと。
// 見るのは、直前のツールの結果（無ければ利用者の発言）より後のテキストだけ。止めた後に日本語で書けば、次の呼び出しは通る。
// 会話ログが読めないときは通す（フックの不具合で作業を止めない）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readFileSync } from 'node:fs';
import { isEnglishOnly, textsSinceLastToolResult } from './japanese-check.ts';
import { readInput } from './vault.ts';

const input = await readInput();
if (!input.transcript_path) process.exit(0);

let texts: string[];
try {
	texts = textsSinceLastToolResult(readFileSync(input.transcript_path, 'utf8'));
} catch {
	process.exit(0);
}
if (!texts.some(isEnglishOnly)) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: '直前の文が英語だけです。その文の日本語訳を本文に書いてから、もう一度呼んでください（共通ルール「言語表記」の「AIエージェント応答の言語」）。',
	},
}));
