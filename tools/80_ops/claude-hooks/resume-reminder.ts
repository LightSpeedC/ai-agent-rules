// 再開（resume）・compact のとき、chat 待受けと cron の張り直しを促す案内（課題 i261025-01）。入口は session-start.ts（p261027-01）。
// 判定はせず、固定の短い案内を出す。手順は写さず、共通ルールの見出し名で指す。ローカルルールは見出し名を指さない（見出しはプロジェクトごとに違う）（「手順は 1 箇所に置く」）。
// フックは応答を始められない。張り直しが始まるのは次の発言を受けてからなので、文言もそう書く（p261027-01 の 3-A）。
// 毎回違う文にするための開始時刻は、入口が入れる。
import { type HookInput } from './vault.ts';

export function resumeReminder(input: HookInput): { message: string; context: string } | null {
	if (input.source !== 'resume' && input.source !== 'compact') return null;
	return {
		message: '🔁 再開: chat 待受け・cron の張り直しを促した',
		context: '再開: chat 待受けと cron は前のセッションから切れている。フックは応答を始められないため、' +
			'次の発言を受けたら、本題の前に張り直す。共通ルール「セッションを開き直したとき」に従い、' +
			'ローカルルールに定義があれば、その値（頻度・prompt・ルーム）を使う。' +
			'cron の予定を過ぎていれば、すぐ実行する。',
	};
}
