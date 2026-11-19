// PreToolUse フック (guard-english-before-tool.ts) が英文で止めるとき、止めた時点の会話ログの様子を残す (決定 441-A、課題 i261031-08)。
// 「訳を書いた直後のツールが前の英語の文で止まる」原因 (止めた時点で、訳がログに書かれていなかったか) を、あとで確かめるための記録。
// 置き場は、このリポジトリの etc/english-deny-logs/ (Git 管理外。環境変数 CLAUDE_ENGLISH_LOG_DIR で差し替えられる)。
// 会話の中身を含むので、Git 管理の外に置く。再起動で消える一時フォルダには置かない。
// 残せなくても、止める動きは変えない (例外は握りつぶす)。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoutedText } from './japanese-check.ts';

const TAIL_LINES = 20;
const KEEP_FILES = 50;
const TEXT_LIMIT = 4000;

// 末尾の 1 行を、記録に残す形へ絞る。このフックは全プロジェクトで動くので、cwd・sessionId・ツールの結果の中身は入れない。
// 画像や大きな結果を含む行がそのまま入ると、1 回で数十 MB になるため、テキストは TEXT_LIMIT 字で切る (rules-review の S1・Q1)。
// 訳がログに書かれていたかの確認に要るのは、役割とテキスト、ツールの前後の並びだけ
function slimLine(line: string): unknown {
	let entry: any;
	try {
		entry = JSON.parse(line);
	} catch {
		return { unreadable: true };
	}
	const message = entry?.message;
	if (!message) return { type: entry?.type };
	const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content : [];
	const blocks = content.map((block: any) => {
		if (block?.type === 'text' && typeof block.text === 'string') {
			const text = block.text.length > TEXT_LIMIT ? block.text.slice(0, TEXT_LIMIT) + `…(${block.text.length - TEXT_LIMIT} 字省略)` : block.text;
			return { type: 'text', text };
		}
		if (block?.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name };
		if (block?.type === 'tool_result') return block.is_error ? { type: 'tool_result', tool_use_id: block.tool_use_id, is_error: true } : { type: 'tool_result', tool_use_id: block.tool_use_id };
		return { type: block?.type };
	});
	return { type: entry.type, role: message.role, blocks };
}

function logDir(): string {
	return process.env.CLAUDE_ENGLISH_LOG_DIR || join(dirname(fileURLToPath(import.meta.url)), '../../../etc/english-deny-logs');
}

// kind: 'deny' は止めた回、'grace' は 1 度猶予して通した回 (決定 445-A)。同じ上限・同じ置き場で残す
export function recordDeny(info: { transcriptPath: string; toolUseId?: string; jsonl: string; texts: RoutedText[]; denied: string[]; kind?: 'deny' | 'grace' }): void {
	try {
		const dir = logDir();
		mkdirSync(dir, { recursive: true });
		const lines = info.jsonl.split(/\r?\n/).filter((line) => line.trim() !== '');
		const timeJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
		const id = (info.toolUseId ?? 'none').replace(/[^\w-]/g, '_');
		const record = {
			kind: info.kind ?? 'deny',
			time_jst: timeJst,
			tool_use_id: info.toolUseId ?? null,
			transcript: basename(info.transcriptPath),
			total_lines: lines.length,
			texts: info.texts,
			denied: info.denied,
			tail: lines.slice(-TAIL_LINES).map(slimLine),
		};
		writeFileSync(join(dir, timeJst.replace(/[:.+]/g, '-') + '-' + id + (info.kind === 'grace' ? '-grace' : '') + '.json'), JSON.stringify(record, null, '\t') + '\n');
		// 新しい KEEP_FILES 件だけ残す (名前が時刻で始まるので、名前順が古い順)
		const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
		for (const name of files.slice(0, Math.max(0, files.length - KEEP_FILES))) rmSync(join(dir, name), { force: true });
	} catch {
		// 記録の失敗で、止める動きを変えない
	}
}
