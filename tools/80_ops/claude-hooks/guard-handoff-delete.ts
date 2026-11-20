// PreToolUse フック: 引継ぎ*.md を消す・移す・上書きする操作を、復唱が会話の記録 (JSONL) に無いまま行うと止める (課題 i261121-01、20260824-ai-pc-public の依頼 #2073)。
// 共通ルール「セッションを引き継ぐ」の復唱を、機械的に確かめる。復唱と削除を同じ応答に並べると、復唱が記録に残らないまま、ファイルだけが消えた。
// 決定 448-A (シェルの操作だけ)・449-A (会話ログ全体)・450-A (全見出し)・451-B (3 回止めたら、4 回目は通して警告する)。
// 設計レビュー (rules-review、2026-11-21): コマンド全体で見る (S1)・行ごとに正規化して見出しで始まるか (S2)・足りない見出しを理由文に出す (S3)・理由文 (S4)・古い復唱は数えない (P1)。
// コードレビュー (同日): 名前が 引継ぎ で始まる .md だけを対象にする・止めた回数は更新時刻ごとに数え、通ったら消す・語はコマンドの位置だけ見る・書き込み系は同じ区切りの中だけ・拡張子なしのワイルドカードも見る。
// PreToolUse の時点では、同じ応答でツールの前に書いた文が、記録にまだ無い (2026-11-19 の実測。課題 i261031-08)。そのため、復唱と削除を同じ応答に並べると止まる。これが狙い。
// 止めたあとは、ツールの呼び出しと、その前の文が記録に入るので、復唱を書いていれば、呼び直せば通る。
// 止めない側に倒す: ファイルが無い・読めない・見出しが 0 件・会話ログが読めない・パスを解決できない・状態を書けない・例外。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readInput, type HookInput } from './vault.ts';

// 消す・移す・上書きする語。追記 (>>・Add-Content・tee -a・Out-File -Append) は、内容を失わないので数えない。
// パスの途中の語 (docs/del/引継ぎ.md) は語ではない
const OP_WORD = /(?<![\w\-./\\:])(Remove-Item|ri|rm|del|erase|rd|rmdir|Move-Item|mi|mv|move|Rename-Item|rni|ren|Set-Content|Clear-Content|Out-File|tee)(?![\w-])/gi;
const WRITE_OPS = new Set(['set-content', 'clear-content', 'out-file', 'tee']);
// コマンドの位置: 行頭・区切り・{ ( の後、-c /c -Command (引用符つき) の後、xargs・-exec の後、git のオプションの後。文章の中の語は、ここに当たらない
const COMMAND_POSITION = /(?:^|[|;&{(\n]|(?:-c|\/c|-command|xargs|-exec)\s+["']?|\bgit(?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--?[\w-]+(?:=\S+)?))*)\s*["']?(?:&\s*)?$/i;
// 上書きのリダイレクト。>> は数えない
const REDIRECT = /(^|[^>\d&])>(?!>)\s*["']?[^\s"'|&;]*引継ぎ[^\s"'|&;]*\.md/;
// 引継ぎ を含む語 (パスつき・ワイルドカードつき)。実際に対象にするのは、名前が 引継ぎ で始まる .md だけ (HANDOFF_NAME)
const TOKEN = /[^\s"'`|&;<>()]*引継ぎ[^\s"'`|&;<>()]*/g;
const HANDOFF_NAME = /^引継ぎ[^/\\]*\.md$/i;
const DENY_LIMIT = 3;

// コミットメッセージ (-m・--message・ヒアドキュメント) の中の記述は、操作ではない
function withoutMessages(command: string): string {
	return command
		.replace(/(\s-m|\s--message)(=|\s*)("(?:[^"\\]|\\.)*"|'[^']*')/g, ' ')
		.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, ' ');
}

// 同じ区切り (| ; 改行 && ||) の中の文字列
function segmentAt(command: string, index: number): string {
	const seps = /\|\||&&|[|;\n]/g;
	let start = 0;
	let end = command.length;
	for (const m of command.matchAll(seps)) {
		if (m.index + m[0].length <= index) start = m.index + m[0].length;
		else if (m.index >= index) {
			end = m.index;
			break;
		}
	}
	return command.slice(start, end);
}

function hasOperation(command: string): boolean {
	const c = withoutMessages(command)
		.replace(/(?<![\w-])tee\s+(-a\b|--append\b)/gi, ' ')
		.replace(/Out-File\b[^|;&\n]*-Append\b/gi, ' ');
	if (REDIRECT.test(c)) return true;
	for (const m of c.matchAll(OP_WORD)) {
		if (!COMMAND_POSITION.test(c.slice(0, m.index))) continue;
		// 書き込み系は、書き込み先が同じ区切りの中にあるときだけ (読んで別のファイルへ写す操作を、止めない)
		if (WRITE_OPS.has(m[1].toLowerCase()) && !/引継ぎ[^\s"'|&;]*\.md/.test(segmentAt(c, m.index))) continue;
		return true;
	}
	return false;
}

// コマンドに出てくる引継ぎ*.md のうち、ディスクにあるファイルを返す。ワイルドカードは展開する。解決できないパスは数えない
function targetFiles(command: string, cwd?: string): string[] {
	const found = new Map<string, string>();
	for (const token of withoutMessages(command).match(TOKEN) ?? []) {
		const path = isAbsolute(token) ? token : cwd ? resolve(cwd, token) : '';
		if (!path) continue;
		const candidates: string[] = [];
		if (/[*?]/.test(basename(path))) {
			const re = new RegExp('^' + basename(path).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
			try {
				for (const name of readdirSync(dirname(path))) if (re.test(name)) candidates.push(join(dirname(path), name));
			} catch {
				continue;
			}
		} else {
			candidates.push(path);
		}
		for (const file of candidates) {
			if (!HANDOFF_NAME.test(basename(file))) continue;
			try {
				if (existsSync(file) && statSync(file).isFile()) found.set(file.replace(/\\/g, '/').toLowerCase(), file);
			} catch {
				// 数えない
			}
		}
	}
	return [...found.values()];
}

// 行の正規化。見出しも復唱の行も同じにする (段・強調・全角半角・引用・箇条書きの違いを吸収する)
function normalize(line: string): string {
	return line
		.normalize('NFKC')
		.replace(/^[\s>#\-*+]+/, '')
		.replace(/^\d+[.)]\s+/, '')
		.replace(/[*_`]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// ファイルの見出し (コードブロックの外の、# の後に空白がある行)
function headingsOf(file: string): string[] {
	const out: string[] = [];
	let fenced = false;
	for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
		if (/^ {0,3}(```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (!fenced && /^#{1,6}\s+\S/.test(line)) {
			const n = normalize(line);
			if (n) out.push(n);
		}
	}
	return out;
}

// 会話ログの、assistant の本文の行 (正規化済み)。since より前の行は数えない。時刻の無い行は数える
function recapLines(transcriptPath: string, since: number): string[] {
	const lines: string[] = [];
	for (const raw of readFileSync(transcriptPath, 'utf8').split('\n')) {
		let entry: any;
		try {
			entry = JSON.parse(raw);
		} catch {
			continue;
		}
		if (entry?.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) continue;
		const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
		if (!Number.isNaN(at) && at < since) continue;
		for (const block of entry.message.content) {
			if (block?.type !== 'text' || typeof block.text !== 'string') continue;
			for (const l of block.text.split(/\r?\n/)) {
				const n = normalize(l);
				if (n) lines.push(n);
			}
		}
	}
	return lines;
}

function stateFile(transcriptPath: string): string {
	return join(process.env.CLAUDE_HANDOFF_GUARD_DIR || join(tmpdir(), 'claude-handoff-guard'), basename(transcriptPath) + '.json');
}

function readCounts(file: string): Record<string, number> {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) ?? {};
	} catch {
		return {};
	}
}

function quote(missing: string[]): string {
	const shown = missing.slice(0, 3).map((h) => `「${h}」`).join('');
	return missing.length > 3 ? `${shown} ほか ${missing.length - 3} 件` : shown;
}

// 止めた回数のキー。ファイルを書き換えたら (更新時刻が変われば)、数え直しになる
function keyOf(file: string): string {
	return `${file.replace(/\\/g, '/').toLowerCase()}@${statSync(file).mtimeMs}`;
}

async function main(): Promise<void> {
	const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { command?: string } };
	const command = data.tool_input?.command ?? '';
	if ((data.tool_name !== 'Bash' && data.tool_name !== 'PowerShell') || !command || !data.transcript_path) return;
	if (!hasOperation(command)) return;
	const files = targetFiles(command, data.cwd);
	if (files.length === 0) return;

	const missingByFile: { file: string; missing: string[] }[] = [];
	const passed: string[] = [];
	for (const file of files) {
		const headings = headingsOf(file);
		if (headings.length === 0) continue;
		const lines = recapLines(data.transcript_path, statSync(file).mtimeMs);
		const missing = headings.filter((h) => !lines.some((l) => l.startsWith(h)));
		if (missing.length > 0) missingByFile.push({ file, missing });
		else passed.push(file);
	}

	const path = stateFile(data.transcript_path);
	// 復唱が通ったファイルの、止めた回数を消す。状態の置き場が無ければ、何も作らない
	if (passed.length > 0 && existsSync(path)) {
		try {
			const counts = readCounts(path);
			for (const f of passed) delete counts[keyOf(f)];
			writeFileSync(path, JSON.stringify(counts));
		} catch {
			// 消せないだけ
		}
	}
	if (missingByFile.length === 0) return;

	// 451-B: 同じファイル・同じセッションで DENY_LIMIT 回止めたら、次は通して警告する。状態を書けなければ、止めない側に倒す
	const counts = readCounts(path);
	const blocking = missingByFile.filter((m) => (counts[keyOf(m.file)] ?? 0) < DENY_LIMIT);
	if (blocking.length === 0) {
		try {
			appendFileSync(path.replace(/\.json$/, '.allowed.log'), `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)} JST ${missingByFile.map((m) => basename(m.file)).join(',')}\n`);
		} catch {
			// 記録できないだけ
		}
		try {
			for (const m of missingByFile) counts[keyOf(m.file)] = 0;
			writeFileSync(path, JSON.stringify(counts));
		} catch {
			// 数え直せないだけ
		}
		console.log(JSON.stringify({ systemMessage: `復唱が記録に無いまま、${DENY_LIMIT} 回止めたあとの呼び出しを通しました (${missingByFile.map((m) => basename(m.file)).join('・')})。次からは、消す前に復唱を応答の本文に書いてください (共通ルール「セッションを引き継ぐ」)。` }));
		return;
	}
	try {
		mkdirSync(dirname(path), { recursive: true });
		for (const m of blocking) counts[keyOf(m.file)] = (counts[keyOf(m.file)] ?? 0) + 1;
		writeFileSync(path, JSON.stringify(counts));
	} catch {
		return;
	}
	const detail = blocking.map((m) => `${basename(m.file)}: ${quote(m.missing)}`).join(' / ');
	console.log(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: `復唱がまだ記録にありません (見出しが足りない: ${detail})。復唱を書いた応答のあとで、改めて消してください。この呼び出しの前に復唱を本文に書いていれば、呼び直せば通ります。書いていなければ、ツールを呼ばない応答の本文で全文を復唱してください (共通ルール「セッションを引き継ぐ」。課題 i261121-01)。`,
		},
	}));
}

// フックの不具合で、操作を止め続けない
await main().catch(() => {});
