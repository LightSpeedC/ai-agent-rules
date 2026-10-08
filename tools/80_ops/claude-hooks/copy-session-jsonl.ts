// SessionStart / Stop フック: 会話ログ（JSONL）を、そのプロジェクト直下の etc/history/jsonl/ へコピーする（直下の決め方は findBase()）。
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
import { jstNow, stamped } from './jst.ts';

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

// 結果を表示する。SessionStart では、開始時刻を additionalContext として一緒に渡す。
// 理由: 再開（--continue / --resume）では、additionalContext が会話にある分と同じだと、同じ回の systemMessage ごと捨てられる
// （Claude Code の重複排除。anthropics/claude-code の issue 96698）。毎回違う短い 1 行を渡し、同じ回に「新しい分」があるようにして、表示を残す。
// 写し先の決め方（環境変数・git・cwd）も添え、実環境でどれが使われたかを確かめられるようにする。
function show(message: string, payload: HookInput | undefined, base?: Base | null): void {
	const out: Record<string, unknown> = { systemMessage: stamped(message) };
	if (payload?.hook_event_name !== 'Stop') {
		const by = base ? `（写し先=${base.by}）` : '';
		const source = payload?.source ? `（source=${payload.source}）` : '';
		out.hookSpecificOutput = {
			hookEventName: 'SessionStart',
			additionalContext: `セッション開始: ${jstNow()} JST${by}${source}`,
		};
	}
	console.log(JSON.stringify(out));
}

// 失敗の理由に、ユーザープロファイル配下のパス（ユーザー名）が混ざらないよう ~ に置き換える
function reason(e: unknown): string {
	const text = e instanceof Error ? e.message : String(e);
	return text.split(homedir()).join('~');
}

type Base = { dir: string; by: 'CLAUDE_PROJECT_DIR' | 'git' | 'cwd' };

// 写し先の起点を決める（課題 i261008-01）。cwd はセッションがその時点で居るフォルダで、cd すると変わるため、
// 環境変数 CLAUDE_PROJECT_DIR（セッションの起点）→ cwd から上へたどった .git のあるフォルダ → cwd の順に使う
function findBase(cwd: string | undefined): Base | null {
	const env = process.env.CLAUDE_PROJECT_DIR;
	if (env) return { dir: env, by: 'CLAUDE_PROJECT_DIR' };
	if (!cwd) return null;
	// cwd がフォルダでなければ（壊れた入力）たどらず、そのまま使う
	if (existsSync(cwd) && statSync(cwd).isDirectory()) {
		for (let dir = cwd; ; ) {
			if (existsSync(join(dir, '.git'))) return { dir, by: 'git' };
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return { dir: cwd, by: 'cwd' };
}

// コピーした件数を返す。入力が足りないときは何もせず null を返す
function copyAll(payload: HookInput, base: Base | null): number | null {
	const transcriptPath = payload.transcript_path;
	if (!transcriptPath || !existsSync(transcriptPath) || !base) return null;

	const sourceDir = dirname(transcriptPath);
	const destDir = join(base.dir, 'etc', 'history', 'jsonl');
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
	let base: Base | null = null;
	try {
		payload = JSON.parse(await readStdin());
		base = findBase(payload!.cwd);
		const copied = copyAll(payload!, base);
		if (copied !== null && payload!.hook_event_name !== 'Stop') {
			show(`✅ 会話ログを ${copied} 件コピーした`, payload, base);
		}
	} catch (e) {
		show('❌ 会話ログのコピーに失敗した: ' + reason(e), payload, base);
	}
}

await main();
