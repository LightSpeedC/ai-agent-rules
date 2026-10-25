// PreToolUse フック: Bash のコマンドの先頭が sed・awk なら止め、Edit・Read を使うよう理由を返す（課題 i261025-01）。
// 権限の拒否（settings の deny）だけでは代わりの手段が分からず、同じ失敗を 8 回繰り返したため、理由に代わりの道具を書く。
// 判定は、区切り（&& || ; | 改行）ごとの先頭語で行う。引数の中に sed・awk という語があるだけでは止めない。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readInput, type HookInput } from './vault.ts';

const SPLIT = /&&|\|\||;|\||\n/;
const BLOCKED = new Set(['sed', 'awk']);

// 区切りごとの先頭語が sed・awk なら、その名前を返す。パス付き（/usr/bin/sed）や先頭の括弧も見る
function blockedWord(command: string): string | undefined {
	for (const segment of command.split(SPLIT)) {
		const word = segment.trim().replace(/^\(+/, '').split(/\s+/)[0] ?? '';
		const name = word.split(/[\\/]/).pop() ?? '';
		if (BLOCKED.has(name)) return name;
	}
	return undefined;
}

const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { command?: string } };
if (data.tool_name !== 'Bash') process.exit(0);

const word = blockedWord(data.tool_input?.command ?? '');
if (word === undefined) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: `${word} は使わない。読むのは Read、書き換えるのは Edit を使う（共通ルール「シェル実行ルール」の「Bash に手が伸びる操作は、道具に置き換える」）。`,
	},
}));
