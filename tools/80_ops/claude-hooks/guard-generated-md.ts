// PreToolUse フック: html2md の生成物の .md を、Edit・Write で直接書き換えるのを止める (課題 i261108-03)。
// ai-agent-tools で、.md だけを書き換えたあと html2md を流して内容が消える失敗が 2 度起きた (#1837)。
// 書き換える先が .md で、同じフォルダに同じ名前の .html (正本) があれば止める。.html が無い .md (手で書く Markdown) は通す。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { readInput, type HookInput } from './vault.ts';

type Input = HookInput & { tool_name?: string; tool_input?: { file_path?: string } };

const data = (await readInput()) as Input;
if (data.tool_name !== 'Edit' && data.tool_name !== 'Write') process.exit(0);

const path = data.tool_input?.file_path ?? '';
if (!/\.md$/i.test(path)) process.exit(0);

const html = path.replace(/\.md$/i, '.html');
if (!existsSync(html)) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: `この .md は html2md の生成物。正本の ${basename(html)} を直して、html2md で作り直す (共通ルール「HTML→Markdown 変換ルール」)。`,
	},
}));
