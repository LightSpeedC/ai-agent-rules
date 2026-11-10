// PreToolUse フック: 一括で載せる git add (-A・--all・.) と git commit -a、パスを名指ししない git commit を止める (課題 i261109-01)。
// git mv・issue set が先に stage したファイルが、パスを指定しない commit に混ざった。git commit -- <path>… はほかに stage されたものを載せない。
// 判定は、区切り (&& || ; | 改行) ごとに語へ分け (引用符の中は 1 語)、git の後ろの -C・-c を飛ばしてサブコマンドを見る。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readInput, type HookInput } from './vault.ts';

// 引用符を外して語に分ける。引用符の中の -- や -A は 1 語の一部になるので、オプションと取り違えない
function words(segment: string): string[] {
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	for (const m of segment.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
	return out;
}

// 区切り (&& || ; | 改行) で分ける。引用符の中 (複数行のメッセージ等) では分けない
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

// 止める理由を返す。止めないときは undefined
function check(command: string): string | undefined {
	for (const segment of segments(command)) {
		const w = words(segment.trim());
		if ((w[0] ?? '').split(/[\\/]/).pop()?.replace(/\.exe$/i, '') !== 'git') continue;
		let i = 1;
		while (w[i] === '-C' || w[i] === '-c') i += 2;
		const sub = w[i];
		const args = w.slice(i + 1);
		if (sub === 'add') {
			const dd = args.indexOf('--');
			const opts = dd < 0 ? args : args.slice(0, dd);
			const paths = dd < 0 ? args.filter((a) => !a.startsWith('-')) : args.slice(dd + 1);
			if (opts.includes('-A') || opts.includes('--all') || paths.some((p) => p === '.' || p === './')) {
				return 'git add の一括 (-A・--all・.) は使わない。載せるファイルを git add <パス>… で名指しする (共通ルール「修正は1点ずつ、確認を重視」)。';
			}
		}
		if (sub === 'commit') {
			const dd = args.indexOf('--');
			const opts = dd < 0 ? args : args.slice(0, dd);
			if (opts.some((a) => a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a))) {
				return 'git commit -a は使わない。載せるファイルを git add <パス>… で名指しする (共通ルール「修正は1点ずつ、確認を重視」)。';
			}
			if (dd < 0 || dd === args.length - 1) {
				return 'git commit は、載せるファイルを -- <パス>… で名指しする (git commit -m … -- <パス>…)。名指しすると、git mv などが先に stage したものが混ざらない (共通ルール「修正は1点ずつ、確認を重視」)。';
			}
		}
	}
	return undefined;
}

const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { command?: string } };
if (data.tool_name !== 'Bash' && data.tool_name !== 'PowerShell') process.exit(0);

const reason = check(data.tool_input?.command ?? '');
if (reason === undefined) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
}));
