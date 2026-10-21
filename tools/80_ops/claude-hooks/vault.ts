// Obsidian Vault を扱う 2 つのフック（load-obsidian-memory・sync-obsidian-vault）が共有する処理。
// 共通ルール「Obsidianメモリ連携ルール」に合わせる（課題 i261018-01）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename } from 'node:path';

export type HookInput = {
	hook_event_name?: string;
	source?: string;
	cwd?: string;
	stop_hook_active?: boolean;
	transcript_path?: string;
};

// 標準入力の JSON を読む。端末につながっているとき・読めないときは空にする
export async function readInput(): Promise<HookInput> {
	if (process.stdin.isTTY) return {};
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
		return JSON.parse(Buffer.concat(chunks).toString('utf8')) ?? {};
	} catch {
		return {};
	}
}

// 失敗の理由・表示に、ユーザープロファイル配下のパス（ユーザー名）が混ざらないよう ~ に置き換える
export function masked(text: string): string {
	return text.split(homedir()).join('~');
}

// 未登録の判定に使うプロジェクト名。CLAUDE_PROJECT_DIR のフォルダ名、無ければ cwd のフォルダ名（依頼 #1548）
export function projectName(input: HookInput): string {
	const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
	return basename(dir.replace(/[\\/]+$/, ''));
}

// safe-push <Vault> --all で同期する。同期の手順（ロック・取り込み・push）は safe-push に閉じ込めてあり、ここでは呼ぶだけ。
// safe-push は共有ツールで、Windows では cmd の入り口なので、シェルを通して呼ぶ。
// 終了コード: 0 成功・ロックで飛ばした / 1 失敗 / 3 衝突 / 4 push 失敗 / 5 引数の誤り（2 は使わない）
export function safePush(vault: string): { code: number | null; output: string } {
	const quoted = '"' + vault.replace(/"/g, '') + '"';
	// timeout は固まったことに気づく唯一の手段（同期 API は待ちを止めるため）。SessionStart の timeout（30 秒）より短くする
	const r = spawnSync(`safe-push ${quoted} --all`, { shell: true, encoding: 'utf8', timeout: 25000 });
	const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
	return { code: r.error ? null : r.status, output: masked(output) };
}

// safe-push の失敗を 1 行で表す。出力の最後の行を添える（どこで止まったかが分かるように）
export function syncFailure(result: { code: number | null; output: string }): string {
	const last = result.output.split(/\r?\n/).filter((line) => line.trim() !== '').pop() ?? '';
	const code = result.code === null ? '時間切れか起動できない' : `終了コード ${result.code}`;
	return `Obsidian Vault の同期に失敗した（safe-push ${code}）` + (last ? `: ${last}` : '');
}
