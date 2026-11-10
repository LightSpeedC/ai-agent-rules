// PreToolUse フック: Bash の cd (pushd) を止める (課題 i261109-02)。
// Bash ツールの cd は、移った先が以降の呼び出しにも残る。共通ルール「シェル実行ルール」で禁じているが 2 回破った。
// 判定は、区切り (&& || ; | 改行) ごとに先頭の語を見る。引用符の中 (メッセージ等) では区切らない。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readInput, type HookInput } from './vault.ts';

// 区切り (&& || ; | 改行) で分ける。引用符の中では分けない
function segments(command: string): string[] {
	const out: string[] = [];
	const re = /"(?:[^"\\]|\\.)*"|'[^']*'|&&|\|\||[;|\n]|[^"';|&\n]+|&/g;
	let cur = '';
	for (const m of command.matchAll(re)) {
		if (/^(&&|\|\||[;|\n])$/.test(m[0])) { out.push(cur); cur = ''; } else cur += m[0];
	}
	out.push(cur);
	return out;
}

function hasCd(command: string): boolean {
	return segments(command).some((s) => /^\(*\s*(cd|pushd)(\s|$)/.test(s.trim()));
}

const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { command?: string } };
if (data.tool_name !== 'Bash') process.exit(0);
if (!hasCd(data.tool_input?.command ?? '')) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: 'Bash で cd しない。移った先が以降の呼び出しにも残る。対象は絶対パスで渡すか、git は git -C <パス> を使う (共通ルール「シェル実行ルール」)。',
	},
}));
