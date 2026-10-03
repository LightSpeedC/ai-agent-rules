// SessionStart / Stop フック: 会話ログ（JSONL）を、そのプロジェクト直下の etc/history/jsonl/ へコピーする。
// 標準入力の JSON（transcript_path・cwd・hook_event_name・source）を読む。コピー対象は transcript_path と同じフォルダの全 *.jsonl。
// サイズと更新日時が同じファイルはスキップする（Stop フックは応答ごとに走るため）。
// 結果は標準出力の JSON の systemMessage でユーザーに見せる（モデルへは渡らない）。
//   SessionStart: 結果を常に表示する / Stop: 失敗したときだけ表示する（成功を毎回出すと 1 行ずつ増えるため）
// SessionStart では、毎回違う開始時刻も additionalContext として渡す（再開時に表示が捨てられないようにするため。show() を参照）。
// 失敗してもセッションを止めないよう、終了コードは常に 0。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type HookInput = {
	transcript_path?: string;
	cwd?: string;
	hook_event_name?: string;
	source?: string;
};

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

// 日時は JST で、yyyy/mm/dd hh:mm:ss.ccc。実行環境のタイムゾーンに依らない
function jstNow(): string {
	return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', '').replaceAll('-', '/');
}

// 結果を表示する。SessionStart では、開始時刻を additionalContext として一緒に渡す。
// 理由: 再開（--continue / --resume）では、additionalContext が会話にある分と同じだと、同じ回の systemMessage ごと捨てられる
// （Claude Code の重複排除。anthropics/claude-code の issue 96698）。毎回違う短い 1 行を渡し、同じ回に「新しい分」があるようにして、表示を残す。
function show(message: string, payload: HookInput | undefined): void {
	const out: Record<string, unknown> = { systemMessage: message };
	if (payload?.hook_event_name !== 'Stop') {
		const source = payload?.source ? `（source=${payload.source}）` : '';
		out.hookSpecificOutput = {
			hookEventName: 'SessionStart',
			additionalContext: `セッション開始: ${jstNow()} JST${source}`,
		};
	}
	console.log(JSON.stringify(out));
}

// 失敗の理由に、ユーザープロファイル配下のパス（ユーザー名）が混ざらないよう ~ に置き換える
function reason(e: unknown): string {
	const text = e instanceof Error ? e.message : String(e);
	return text.split(homedir()).join('~');
}

// コピーした件数を返す。入力が足りないときは何もせず null を返す
function copyAll(payload: HookInput): number | null {
	const transcriptPath = payload.transcript_path;
	const cwd = payload.cwd;
	if (!transcriptPath || !existsSync(transcriptPath) || !cwd) return null;

	const sourceDir = dirname(transcriptPath);
	const destDir = join(cwd, 'etc', 'history', 'jsonl');
	mkdirSync(destDir, { recursive: true });

	let copied = 0;
	for (const name of readdirSync(sourceDir)) {
		if (!name.endsWith('.jsonl')) continue;
		const src = join(sourceDir, name);
		const dst = join(destDir, name);
		const srcStat = statSync(src);
		if (!srcStat.isFile()) continue;
		if (existsSync(dst)) {
			const dstStat = statSync(dst);
			// 更新日時はミリ秒の端数が丸められることがあるため、1ms 未満の差は同じとみなす
			if (dstStat.size === srcStat.size && Math.abs(dstStat.mtimeMs - srcStat.mtimeMs) < 1) continue;
		}
		copyFileSync(src, dst);
		// copyFile は更新日時を引き継がない。次回のスキップ判定のため、元に揃える
		utimesSync(dst, srcStat.atime, srcStat.mtime);
		copied++;
	}
	return copied;
}

async function main(): Promise<void> {
	let payload: HookInput | undefined;
	try {
		payload = JSON.parse(await readStdin());
		const copied = copyAll(payload!);
		if (copied !== null && payload!.hook_event_name !== 'Stop') {
			show(`✅ 会話ログを ${copied} 件コピーした`, payload);
		}
	} catch (e) {
		show('❌ 会話ログのコピーに失敗した: ' + reason(e), payload);
	}
}

await main();
