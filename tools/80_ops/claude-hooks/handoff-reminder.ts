// Stop フック: 会話の記録 (JSONL) が 10 MB 以上になったら、引継ぎの提案を促す (課題 i261103-02)。
// 共通ルール「会話の記録が大きくなったら引き継ぐ」を受け持つ。AI は記録の大きさを自分では知れない。圧縮の回数は見ない。
// 促すのは、条件に当たった後の最初の 1 回だけ。印は、一時フォルダにセッションの記録の名前で置く (CLAUDE_HANDOFF_MARK_DIR で差し替えられる)。
// 促した結果の Stop (stop_hook_active) では促さず、印も付けない (促し続けて止まらなくなるのを防ぐ)。
// 記録が読めないときは促さない (フックの不具合で止め続けないため)。終了コードは常に 0。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readInput } from './vault.ts';

export const sizeLimitBytes = 10 * 1024 * 1024;

// 促す文。条件に当たっていなければ null
export function handoffReason(bytes: number): string | null {
	if (bytes < sizeLimitBytes) return null;
	return `会話の記録が ${(bytes / 1024 / 1024).toFixed(1)} MB (10 MB 以上) になっています。作業の区切りで、利用者に引継ぎを提案してください。自分の判断でセッションを終えないでください。共通ルール「会話の記録が大きくなったら引き継ぐ」に従ってください。`;
}

async function main(): Promise<void> {
	const input = await readInput();
	if (input.stop_hook_active || !input.transcript_path) return;
	let bytes = 0;
	try {
		bytes = statSync(input.transcript_path).size;
	} catch {
		return;
	}
	const reason = handoffReason(bytes);
	if (reason === null) return;

	const dir = process.env.CLAUDE_HANDOFF_MARK_DIR || join(tmpdir(), 'claude-handoff-marks');
	const mark = join(dir, basename(input.transcript_path));
	if (existsSync(mark)) return;
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(mark, '');
	} catch {
		return; // 印を置けないと毎回促すことになるため、促さない
	}
	console.log(JSON.stringify({ decision: 'block', reason }));
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('handoff-reminder.ts')) await main();
