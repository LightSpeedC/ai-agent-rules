// Obsidian Vault を同期してから、memory/!memory.md（メモリ目次）と projects/!projects.md（プロジェクト一覧）を注入する処理。入口は session-start.ts（p261027-01）。
// 共通ルール「Obsidianメモリ連携ルール」に合わせる（課題 i261018-01）。注入文には手順を写さず、見出し名で指す。
// Vault の場所は環境変数 AI_AGENT_OBSIDIAN_VAULT で渡す。
// 未設定・ファイルが無いときは何も注入しない（連携していない PC でもフックが壊れないように）。
// 同期（safe-push）に失敗しても、注入は続ける（依頼 #1548）。
// 毎回違う文にするための開始時刻は、入口が入れる。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stamped } from './jst.ts';
import { type HookInput, masked, projectName, safePush, syncFailure } from './vault.ts';

function reason(e: unknown): string {
	return masked(e instanceof Error ? e.message : String(e));
}

function header(vault: string): string {
	return `# Obsidian メモリ（起動時ロード）

以下は Obsidian Vault の目次（memory/!memory.md）とプロジェクト一覧（projects/!projects.md）です。
Vault の場所: ${masked(vault).replace(/\\/g, '/')}（環境変数 AI_AGENT_OBSIDIAN_VAULT）
Vault のファイルは Read・Write・Edit で直接読み書きしてください（Obsidian が起動していなくてよい）。
何を・いつ書くかは、共通ルール「Obsidianメモリ連携ルール」に従ってください。`;
}

function section(name: string, text: string): string {
	return `----- ${name} ここから -----\n${text}\n----- ${name} ここまで -----`;
}

// message は日時を付けた表示（同期の失敗があれば 2 行）。context は注入文で、注入しないときは無い。
// 再開（source=resume）では、同じ内容が会話にあると Claude Code が取り込まない（重複排除）。フックには取り込まれたかが分からないので、
// 「注入した」と言い切らず、「渡した」と書く。
export function obsidianMemory(input: HookInput): { message: string; context?: string } {
	const vault = process.env.AI_AGENT_OBSIDIAN_VAULT;
	if (!vault) return { message: stamped('⬜ Obsidian メモリ: 環境変数が未設定のため注入なし') };

	// ほかの PC・クラウドの分を取り込んでから読む
	const sync = safePush(vault);
	const syncNote = sync.code === 0 ? '' : '\n' + stamped('⚠️ ' + syncFailure(sync));

	const memoryPath = join(vault, 'memory', '!memory.md');
	if (!existsSync(memoryPath)) return { message: stamped('⬜ Obsidian メモリ: !memory.md が無いため注入なし') + syncNote };

	let memory: string;
	let projects: string | undefined;
	try {
		memory = readFileSync(memoryPath, 'utf8');
		const projectsPath = join(vault, 'projects', '!projects.md');
		if (existsSync(projectsPath)) projects = readFileSync(projectsPath, 'utf8');
	} catch (e) {
		return { message: stamped('❌ Obsidian メモリの読み込みに失敗した: ' + reason(e)) + syncNote };
	}

	const parts = [header(vault), section('!memory.md', memory)];
	if (projects !== undefined) parts.push(section('!projects.md', projects));

	// 未登録なら、登録を促す。Vault 自体も特別扱いしない（依頼 #1548）
	const name = projectName(input);
	if (!existsSync(join(vault, 'projects', `${name}.md`))) {
		parts.push(`このプロジェクト（${name}）は projects/ に未登録です。共通ルール「Obsidianメモリ連携ルール」の「いつ書くか」に従って登録してください。`);
	}

	return {
		message: stamped(input.source === 'resume'
			? '✅ Obsidian メモリを渡した（再開では、会話にあれば取り込まれない）'
			: '✅ Obsidian メモリを注入した') + syncNote,
		context: parts.join('\n\n'),
	};
}
