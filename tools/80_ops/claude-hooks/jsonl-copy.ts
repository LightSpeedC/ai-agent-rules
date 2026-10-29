// 会話ログ（JSONL）を、そのプロジェクト直下の etc/history/jsonl/ へコピーする処理（直下の決め方は findBase()）。
// 入口は 2 つ: SessionStart は session-start.ts、Stop は copy-session-jsonl.ts（p261027-01）。
// コピー対象は transcript_path と同じフォルダの全 *.jsonl。サイズと更新日時が同じファイルはスキップする（Stop フックは応答ごとに走るため）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { jstNow } from './jst.ts';
import { type HookInput } from './vault.ts';

export type Base = { dir: string; by: 'CLAUDE_PROJECT_DIR' | 'git' | 'cwd' };

// 失敗の理由に、ユーザープロファイル配下のパス（ユーザー名）が混ざらないよう ~ に置き換える
export function reason(e: unknown): string {
	const text = e instanceof Error ? e.message : String(e);
	return text.split(homedir()).join('~');
}

// 写し先の起点を決める（課題 i261008-01）。cwd はセッションがその時点で居るフォルダで、cd すると変わるため、
// 環境変数 CLAUDE_PROJECT_DIR（セッションの起点）→ cwd から上へたどった .git のあるフォルダ → cwd の順に使う
export function findBase(cwd: string | undefined): Base | null {
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

// コピーして、表示する文言（日時は付けない）を返す。コピーしなかったときは message が null。例外は投げない
export function copyJsonl(payload: HookInput): { message: string | null; failed: boolean; base: Base | null } {
	let base: Base | null = null;
	try {
		base = findBase(payload.cwd);
		const copied = copyAll(payload, base);
		return { message: copied === null ? null : `✅ 会話ログを ${copied} 件コピーした`, failed: false, base };
	} catch (e) {
		return { message: '❌ 会話ログのコピーに失敗した: ' + reason(e), failed: true, base };
	}
}

// 毎回違う開始時刻の行。再開（--continue / --resume）では、additionalContext が会話にある分と同じだと Claude Code が捨てる
// （重複排除。anthropics/claude-code の issue 96698）ため、これを添えて毎回違う文にする。
// 写し先の決め方（環境変数・git・cwd）も添え、実環境でどれが使われたかを確かめられるようにする。
export function startLine(payload: HookInput | undefined, base: Base | null): string {
	const by = base ? `（写し先=${base.by}）` : '';
	const source = payload?.source ? `（source=${payload.source}）` : '';
	return `セッション開始: ${jstNow()} JST${by}${source}`;
}
