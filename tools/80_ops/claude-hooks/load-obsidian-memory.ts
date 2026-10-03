// SessionStart フック: Obsidian Vault の memory/!memory.md（AIメモリ目次）をセッションに注入する。
// 出力した JSON の hookSpecificOutput.additionalContext が Claude のコンテキストに追加される。
// Vault の場所は環境変数 AI_AGENT_OBSIDIAN_VAULT で渡す。
// 未設定・ファイルが無いときは何も注入せず正常終了する（連携していない PC でもフックが壊れないように）。
// 結果は標準出力の JSON の systemMessage でユーザーに見せる（モデルへは渡らない）。
// 失敗してもセッションを止めないよう、終了コードは常に 0。
// 標準入力の JSON の source（startup / resume / clear / compact）は、表示の文言を決めるためだけに読む。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stamped } from './jst.ts';

// 表示の先頭に、絵文字に続けて日付（月/日）と時刻（時:分）を付ける（jst.ts を参照）
function show(message: string): void {
	console.log(JSON.stringify({ systemMessage: stamped(message) }));
}

// 失敗の理由に、ユーザープロファイル配下のパス（ユーザー名）が混ざらないよう ~ に置き換える
function reason(e: unknown): string {
	const text = e instanceof Error ? e.message : String(e);
	return text.split(homedir()).join('~');
}

async function readSource(): Promise<string | undefined> {
	// 端末につながっているときは、入力を待たない
	if (process.stdin.isTTY) return undefined;
	try {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
		return JSON.parse(Buffer.concat(chunks).toString('utf8')).source;
	} catch {
		return undefined;
	}
}

const header = `# Obsidian メモリ（起動時ロード）

以下は Obsidian Vault のメモリ目次（memory/!memory.md）です。
作業に関連するメモリノートがあれば obsidian-mcp MCP または Read で本文を読み込んでください。
作業完了時は、新しい事実を memory/ 配下にノート化し、この !memory.md の「メモリ一覧」へ1行追記してください。

----- !memory.md ここから -----`;

// 再開（source=resume）では、同じ内容が会話にあると Claude Code が取り込まない（重複排除）。フックには取り込まれたかが分からないので、
// 「注入した」と言い切らず、「渡した」と書く。
function inject(source: string | undefined): void {
	const vault = process.env.AI_AGENT_OBSIDIAN_VAULT;
	if (!vault) {
		show('⬜ Obsidian メモリ: 環境変数が未設定のため注入なし');
		return;
	}

	const memoryPath = join(vault, 'memory', '!memory.md');
	if (!existsSync(memoryPath)) {
		show('⬜ Obsidian メモリ: !memory.md が無いため注入なし');
		return;
	}

	let memory: string;
	try {
		memory = readFileSync(memoryPath, 'utf8');
	} catch (e) {
		show('❌ Obsidian メモリの読み込みに失敗した: ' + reason(e));
		return;
	}

	const context = header + '\n' + memory + '\n----- !memory.md ここまで -----';
	console.log(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'SessionStart',
			additionalContext: context,
		},
		systemMessage: stamped(source === 'resume'
			? '✅ Obsidian メモリを渡した（再開では、会話にあれば取り込まれない）'
			: '✅ Obsidian メモリを注入した'),
	}));
}

inject(await readSource());
