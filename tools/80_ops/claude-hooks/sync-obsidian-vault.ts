// Stop フック: Obsidian Vault の daily の追記を促し、safe-push で同期する。
// 共通ルール「Obsidianメモリ連携ルール」の「commit と push は Stop フックが行う」「作業の区切り: … Stop フックが促す」を受け持つ（課題 i261018-01）。
// daily の最後の追記（daily/ の中で最も新しいファイルの更新日時）から 6 時間以上空いていれば、decision: block で Claude に追記を促す（依頼 #1548）。
// 促した結果の Stop（stop_hook_active）では促さず、同期だけ行う（促し続けて止まらなくなるのを防ぐ）。
// 同期の成功は表示しない（Stop は応答のたびに走るため）。失敗したときだけ表示する。
// 終了コードは常に 0（2 は「続ける」と読まれる。止めるかどうかは decision で伝える）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stamped } from './jst.ts';
import { readInput, projectName, safePush, syncFailure } from './vault.ts';

const promptAfterMs = 6 * 3600 * 1000;

// daily/ の中で最も新しいファイルの更新日時。daily/ が無い・空なら null
function lastDailyWrite(vault: string): number | null {
	const dir = join(vault, 'daily');
	if (!existsSync(dir)) return null;
	let latest: number | null = null;
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.md')) continue;
		const mtime = statSync(join(dir, name)).mtimeMs;
		if (latest === null || mtime > latest) latest = mtime;
	}
	return latest;
}

async function main(): Promise<void> {
	const vault = process.env.AI_AGENT_OBSIDIAN_VAULT;
	if (!vault) return;
	const input = await readInput();

	if (!input.stop_hook_active) {
		let last: number | null = null;
		try {
			last = lastDailyWrite(vault);
		} catch {
			last = null;
		}
		if (last === null || Date.now() - last >= promptAfterMs) {
			const name = projectName(input);
			console.log(JSON.stringify({
				decision: 'block',
				reason: `Obsidian Vault の daily（作業日誌）に、このプロジェクト（${name}）の作業の要点を追記してください。最後の追記から 6 時間以上空いています。書き方は共通ルール「Obsidianメモリ連携ルール」に従ってください。`,
			}));
			return;
		}
	}

	const sync = safePush(vault);
	if (sync.code !== 0) {
		console.log(JSON.stringify({ systemMessage: stamped('❌ ' + syncFailure(sync)) }));
	}
}

await main();
