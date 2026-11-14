// PreToolUse フック: git commit の前に、会話の記録 (JSONL) を読み、失敗したままの Edit・Write があれば止める (課題 i261101-01)。
// 20261019-file-manager で、Edit の失敗を見ずに commit し、壊れたファイルが入った (#1727。サンプルを元にした)。
// 印を解くのは、失敗の後の同じファイルへの Edit・Write か Read が通ったとき。通った commit より前の失敗は見ない。
// 14-A (11/04、20261019-file-manager の報告 #1783): --dry-run の commit は何も commit しないので、止めず、区切りにもしない。
// 同じ応答に並べた Edit・Write の失敗は、フックから知れない (11/05 実測。調査 r261105-01)。共通ルールで並べないと決めた (21-A)。
// 記録が読めないときは止めない (フックの不具合で commit を止め続けないため)。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readFileSync } from 'node:fs';
import { readInput, type HookInput } from './vault.ts';

const SPLIT = /&&|\|\||;|\||\n/;

// 区切りごとに、先頭が git で、オプション (-c x=y ・ -C <path> 等) の後に commit があるか。--dry-run 付きは対象外
// --dry-run は引用符の外だけを見る。コミットメッセージの中の文字 (-m "--dry-run を直す") はオプションではない
export function isCommit(command: string): boolean {
	return command.split(SPLIT).some((s) => {
		if (!/^\s*\(*\s*git(\s+(-[cC]\s+("[^"]*"|'[^']*'|\S+)|--?[\w-]+(=\S+)?))*\s+commit\b/.test(s)) return false;
		const outsideQuotes = s.replace(/"[^"]*"|'[^']*'/g, ' ');
		return !/(^|\s)--dry-run(\s|=|$)/.test(outsideQuotes);
	});
}

// Windows は大小を区別しないため、区切りと大小を揃えて比べる
function key(file: string): string {
	return file.replace(/\\/g, '/').toLowerCase();
}

// file が、置き場 (cwd) の中にあるか。区切りと大小を揃えて比べ、前方が同じだけの別のフォルダ (proj2) は外とする
function isInside(file: string, cwd: string): boolean {
	const base = key(cwd).replace(/\/+$/, '');
	const f = key(file);
	return f === base || f.startsWith(base + '/');
}

// 失敗したままのファイルを、記録の順に返す。cwd を渡すと、その外のパスの失敗は数えない (課題 i261114-02、決定 424-A)。
// commit に載るのは置き場の中のファイルだけで、worktree の子が親の checkout の存在しないパスで失敗しても、載せようがないため
export function failedFiles(jsonl: string, cwd?: string): string[] {
	const uses = new Map<string, { name: string; file?: string; command?: string }>();
	let failed = new Map<string, string>(); // 揃えた名前 → 元の名前
	for (const line of jsonl.split('\n')) {
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const contents = Array.isArray(entry?.message?.content) ? entry.message.content : [];
		for (const c of contents) {
			if (c?.type === 'tool_use') {
				uses.set(c.id, { name: c.name, file: c.input?.file_path, command: c.input?.command });
				continue;
			}
			if (c?.type !== 'tool_result') continue;
			const use = uses.get(c.tool_use_id);
			if (!use) continue;
			const error = c.is_error === true;
			if (use.file && (use.name === 'Edit' || use.name === 'Write')) {
				if (error) failed.set(key(use.file), use.file);
				else failed.delete(key(use.file));
			} else if (use.file && use.name === 'Read' && !error) {
				failed.delete(key(use.file));
			} else if (use.command && isCommit(use.command) && !error) {
				failed = new Map();
			}
		}
	}
	const all = [...failed.values()];
	return cwd ? all.filter((file) => isInside(file, cwd)) : all;
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('guard-commit-after-failed-edit.ts')) {
	const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { command?: string }; transcript_path?: string; cwd?: string };
	if (data.tool_name !== 'Bash' && data.tool_name !== 'PowerShell') process.exit(0);
	if (!isCommit(data.tool_input?.command ?? '') || !data.transcript_path) process.exit(0);

	let jsonl = '';
	try {
		jsonl = readFileSync(data.transcript_path, 'utf8');
	} catch {
		process.exit(0);
	}
	const files = failedFiles(jsonl, data.cwd);
	if (files.length === 0) process.exit(0);

	console.log(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: `失敗したままの Edit・Write がある: ${files.join(', ')}。Read で直しが入ったことを確かめるか、同じファイルへの Edit を通してから commit する (課題 i261101-01)。`,
		},
	}));
}
