// Stop フック: 会話ログ（JSONL）を、そのプロジェクト直下の etc/history/jsonl/ へコピーする（処理は jsonl-copy.ts）。
// SessionStart のコピーは session-start.ts が行う（p261027-01）。この入口は、SessionStart の入力でも従来どおり動く。
// 結果は標準出力の JSON の systemMessage でユーザーに見せる（モデルへは渡らない）。
//   SessionStart: 結果を常に表示する / Stop: 失敗したときだけ表示する（成功を毎回出すと 1 行ずつ増えるため）
// 失敗してもセッションを止めないよう、終了コードは常に 0。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { stamped } from './jst.ts';
import { type Base, copyJsonl, reason, startLine } from './jsonl-copy.ts';
import { type HookInput } from './vault.ts';

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

// 結果を表示する。SessionStart では、開始時刻を additionalContext として一緒に渡す（再開時に表示が捨てられないようにするため。startLine を参照）
function show(message: string, payload: HookInput | undefined, base: Base | null): void {
	const out: Record<string, unknown> = { systemMessage: stamped(message) };
	if (payload?.hook_event_name !== 'Stop') {
		out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: startLine(payload, base) };
	}
	console.log(JSON.stringify(out));
}

let payload: HookInput | undefined;
try {
	payload = JSON.parse(await readStdin());
} catch (e) {
	show('❌ 会話ログのコピーに失敗した: ' + reason(e), undefined, null);
}
if (payload) {
	const result = copyJsonl(payload);
	if (result.message !== null && (result.failed || payload.hook_event_name !== 'Stop')) show(result.message, payload, result.base);
}
