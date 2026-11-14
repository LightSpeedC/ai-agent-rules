// PreToolUse フック: Bash のコマンドの先頭が sed・awk なら止め、Edit・Read を使うよう理由を返す（課題 i261025-01）。
// ssh の引数の中の sed -i は、Bash と PowerShell の両方で止める（課題 i261113-01）。
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

// 区切りごとの先頭語が ssh で、その引数の中に sed -i (-i.bak ・ -ni ・ --in-place を含む) があれば true (課題 i261113-01、依頼 #1944)。
// ssh 先で sed -i を使うと、先頭語が ssh のため止まらず、設定ファイルの \ が消えた (11/07)。依頼は sed -i だけなので、読むだけの sed・awk は止めない
function sshInPlaceSed(command: string): boolean {
	for (const segment of command.split(SPLIT)) {
		const word = segment.trim().replace(/^\(+/, '').split(/\s+/)[0] ?? '';
		const name = (word.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '');
		if (name !== 'ssh') continue;
		if (/\bsed\b.*?(\s-[A-Za-z]*i\S*|--in-place)/.test(segment)) return true;
	}
	return false;
}

const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { command?: string } };
// ssh の引数の中の sed -i だけは、PowerShell ツールでも見る (20260917-oracle-cloud の報告 #1979)。手元の sed・awk を止めるのは Bash だけ
if (data.tool_name !== 'Bash' && data.tool_name !== 'PowerShell') process.exit(0);

const command = data.tool_input?.command ?? '';
const word = data.tool_name === 'Bash' ? blockedWord(command) : undefined;
if (word === undefined && sshInPlaceSed(command)) {
	console.log(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: 'ssh の引数の中の sed -i は使わない (設定ファイルの \\ が消えた事故がある)。ファイルを手元に取り、Edit で書き換えて送る (共通ルール「シェル実行ルール」の「Bash に手が伸びる操作は、道具に置き換える」)。',
		},
	}));
	process.exit(0);
}
if (word === undefined) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: `${word} は使わない。読むのは Read、書き換えるのは Edit を使う（共通ルール「シェル実行ルール」の「Bash に手が伸びる操作は、道具に置き換える」）。`,
	},
}));
