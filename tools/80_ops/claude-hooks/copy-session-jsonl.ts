// SessionStart / Stop フック: 会話ログ（JSONL）を、そのプロジェクト直下の etc/history/jsonl/ へコピーする。
// 標準入力の JSON（transcript_path・cwd）を読む。コピー対象は transcript_path と同じフォルダの全 *.jsonl。
// サイズと更新日時が同じファイルはスキップする（Stop フックは応答ごとに走るため）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

let payload: { transcript_path?: string; cwd?: string };
try {
	payload = JSON.parse(await readStdin());
} catch (e) {
	console.error('標準入力の JSON を読めませんでした: ' + (e as Error).message);
	process.exit(0);
}

const transcriptPath = payload.transcript_path;
const cwd = payload.cwd;
if (!transcriptPath || !existsSync(transcriptPath) || !cwd) process.exit(0);

const sourceDir = dirname(transcriptPath);
const destDir = join(cwd, 'etc', 'history', 'jsonl');
mkdirSync(destDir, { recursive: true });

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
}
