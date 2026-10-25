// SessionStart フック: 再開（resume）・compact のとき、chat 待受けと cron の張り直しを促す（課題 i261025-01）。
// 判定はせず、固定の短い案内を出す。手順は写さず、共通ルールの見出し名で指す。ローカルルールは見出し名を指さない（見出しはプロジェクトごとに違う）（「手順は 1 箇所に置く」）。
// 文は実行のたびに変える（時刻を入れる）。同じ文が会話にあると Claude Code が捨てる（重複排除）ため。
// 出力した JSON の hookSpecificOutput.additionalContext が Claude のコンテキストに追加され、systemMessage はユーザーに見える。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { jstNow, stamped } from './jst.ts';
import { readInput } from './vault.ts';

const input = await readInput();
if (input.source !== 'resume' && input.source !== 'compact') process.exit(0);

const text = '再開: chat 待受けと cron は前のセッションから切れている。共通ルール「セッションを開き直したとき」に従い、' +
	'ローカルルールに定義があれば、その値（頻度・prompt・ルーム）で、指示を待たずに張り直す。' +
	'cron の予定を過ぎていれば、すぐ実行する。' +
	`（${jstNow()}）`;

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'SessionStart',
		additionalContext: text,
	},
	systemMessage: stamped('🔁 再開: chat 待受け・cron の張り直しを促した'),
}));
