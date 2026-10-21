// Stop フック: 最後の応答が英語だけなら、日本語で書き直させる（課題 p261021-01）。
// 共通ルール「言語表記」の「AIエージェント応答の言語」（応答は常に日本語）を機械的に確かめる。
// 英語の応答は、Stop の時点で画面に既に出ている。書き直しは、その後に出る新しい応答で行われる（後追い）。
// 書き直させるのは 1 回まで。stop_hook_active が true のときは、もう書き直させず、❌ を表示する（ループを防ぐため）。
// 終了コードは常に 0（2 は「続ける」と読まれる。止めるかどうかは decision で伝える）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readFileSync } from 'node:fs';
import { stamped } from './jst.ts';
import { isEnglishOnly, lastAssistantText } from './japanese-check.ts';
import { readInput } from './vault.ts';

const reason = '応答は日本語で書いてください。英語だけの応答を検出しました。日本語で書き直してください。技術用語・識別子・コマンドは原文のままで構いません。';

async function main(): Promise<void> {
	const input = await readInput();
	if (!input.transcript_path) return;

	let text: string;
	try {
		text = lastAssistantText(readFileSync(input.transcript_path, 'utf8'));
	} catch {
		return;
	}
	if (!isEnglishOnly(text)) return;

	if (input.stop_hook_active) {
		console.log(JSON.stringify({ systemMessage: stamped('❌ 英語だけの応答を検出したが、書き直しは 1 回までのため止めた') }));
		return;
	}
	console.log(JSON.stringify({
		decision: 'block',
		reason,
		systemMessage: stamped('⚠️ 英語だけの応答を、日本語で書き直させる'),
	}));
}

await main();
