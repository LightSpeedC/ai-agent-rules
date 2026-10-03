// SessionStart フック: Obsidian Vault の memory/!memory.md（AIメモリ目次）をセッションに注入する。
// 出力した JSON の hookSpecificOutput.additionalContext が Claude のコンテキストに追加される。
// Vault の場所は環境変数 AI_AGENT_OBSIDIAN_VAULT で渡す。
// 未設定・ファイルが無いときは何も注入せず正常終了する（連携していない PC でもフックが壊れないように）。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.env.AI_AGENT_OBSIDIAN_VAULT;
if (!vault) process.exit(0);

const memoryPath = join(vault, 'memory', '!memory.md');
if (!existsSync(memoryPath)) process.exit(0);

const memory = readFileSync(memoryPath, 'utf8');

const header = `# Obsidian メモリ（起動時ロード）

以下は Obsidian Vault のメモリ目次（memory/!memory.md）です。
作業に関連するメモリノートがあれば obsidian-mcp MCP または Read で本文を読み込んでください。
作業完了時は、新しい事実を memory/ 配下にノート化し、この !memory.md の「メモリ一覧」へ1行追記してください。

----- !memory.md ここから -----`;

const context = header + '\n' + memory + '\n----- !memory.md ここまで -----';

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'SessionStart',
		additionalContext: context,
	},
}));
