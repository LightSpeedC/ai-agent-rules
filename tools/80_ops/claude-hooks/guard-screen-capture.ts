// PreToolUse フック: 画面の範囲を撮る呼び出しを止める (課題 i261101-02)。
// 共通ルール「利用者に見せる前に、自分で見る」の「撮るのは、確かめる窓だけにする」を、フックで守らせる。
// 元は 20261019-file-manager のサンプル (#1732、振り返り 416-A)。
//
// 止める語 (7-A): CopyFromScreen ・ GetDC(0 の類) ・ GetWindowDC(GetDesktopWindow())。
//   窓 1 つを撮るときにも使う BitBlt ・ PrintWindow ・ PrimaryScreen は止めない。
// 見る所 (6-C ・ 9-A):
//   - Bash ・ PowerShell のコマンドの文字列と、そこに出た .ps1 ・ .psm1 ・ .cs のファイルの中身
//   - Write の content ・ Edit の new_string。書く先がスクリプト (.ps1 ・ .psm1 ・ .cs ・ .cmd ・ .bat) のときだけ
// 止め方 (8-A): deny。入力が読めないときは通す。

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

export const PATTERNS: { name: string; re: RegExp }[] = [
	{ name: 'CopyFromScreen', re: /CopyFromScreen/i },
	{ name: 'GetDC(0)', re: /\bGetDC\s*\(\s*(0|\[IntPtr\]::Zero|IntPtr\.Zero|null)\s*\)/i },
	{ name: 'GetWindowDC(GetDesktopWindow())', re: /GetWindowDC\s*\(\s*[\w.\[\]:]*GetDesktopWindow\s*\(\s*\)\s*\)/i },
];

const SCRIPT_EXT = /\.(ps1|psm1|cs|cmd|bat)$/i;
const SCRIPT_IN_COMMAND = /[^\s"'`]+\.(ps1|psm1|cs)\b/gi;

export function findWord(text: string): string | undefined {
	return PATTERNS.find((p) => p.re.test(text))?.name;
}

// 当たった語と、どこで当たったかを返す。当たらなければ undefined
export function check(toolName: string, toolInput: Record<string, unknown>, readText: (path: string) => string | undefined): { word: string; where: string } | undefined {
	if (toolName === 'Bash' || toolName === 'PowerShell') {
		const command = String(toolInput.command ?? '');
		const w = findWord(command);
		if (w) return { word: w, where: 'コマンド' };
		for (const m of command.matchAll(SCRIPT_IN_COMMAND)) {
			const body = readText(m[0]);
			const w2 = body === undefined ? undefined : findWord(body);
			if (w2) return { word: w2, where: m[0] };
		}
		return undefined;
	}
	if (toolName === 'Write' || toolName === 'Edit') {
		const path = String(toolInput.file_path ?? '');
		if (!SCRIPT_EXT.test(path)) return undefined;
		const text = String(toolName === 'Write' ? toolInput.content ?? '' : toolInput.new_string ?? '');
		const w = findWord(text);
		return w ? { word: w, where: path } : undefined;
	}
	return undefined;
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const c of process.stdin) chunks.push(c as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

const isMain = (import.meta as { main?: boolean }).main ?? (argv[1] ?? '').replaceAll('\\', '/').endsWith('guard-screen-capture.ts');
if (isMain) {
	let input: { tool_name?: string; tool_input?: Record<string, unknown> };
	try {
		input = JSON.parse(await readStdin());
	} catch {
		process.exit(0);
	}
	const hit = check(input.tool_name ?? '', input.tool_input ?? {}, (p) => {
		try {
			return readFileSync(p, 'utf8');
		} catch {
			return undefined;
		}
	});
	if (hit) {
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: `画面の範囲を撮る呼び出し (${hit.word}、${hit.where}) を止めました。ほかの窓 (個人の情報) が写り、会話の記録に残ります。確かめる窓だけを、その窓のハンドルから写してください (GetWindowDC(hwnd) ＋ BitBlt、または PrintWindow)。共通ルール「利用者に見せる前に、自分で見る」。`,
			},
		}));
	}
}
