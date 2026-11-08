// PreToolUse フック: 作業記録 (_config/ の HTML) に、JST を添えない UTC の時刻を書く Edit・Write を止める (課題 i261108-01)。
// 20260917-oracle-cloud で、UTC の出力を JST に直さずに作業記録へ書いた。ルールの更新 (#1823) だけでは止まらなかった。
// 見るのは新しく書く分だけ (Write の content・Edit の new_string)。元からある行は止めない。
// 同じ行に JST があれば通す (コマンドの生の UTC を、JST を添えて写す形を許す)。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { readInput, type HookInput } from './vault.ts';

type Input = HookInput & { tool_name?: string; tool_input?: { file_path?: string; content?: string; new_string?: string } };

// パスに _config/ を含む .html か
function isRecord(path: string): boolean {
	const p = path.replaceAll('\\', '/').toLowerCase();
	return p.endsWith('.html') && (p.includes('/_config/') || p.startsWith('_config/'));
}

// JST の無い UTC の行を返す
function utcLine(text: string): string | undefined {
	return text.split(/\r?\n/).find(line => /\bUTC\b/.test(line) && !/\bJST\b/.test(line));
}

const data = (await readInput()) as Input;
if (data.tool_name !== 'Edit' && data.tool_name !== 'Write') process.exit(0);
if (!isRecord(data.tool_input?.file_path ?? '')) process.exit(0);

const text = data.tool_name === 'Write' ? data.tool_input?.content : data.tool_input?.new_string;
const line = utcLine(text ?? '');
if (line === undefined) process.exit(0);

console.log(JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PreToolUse',
		permissionDecision: 'deny',
		permissionDecisionReason: `作業記録の時刻は JST で書く。UTC の出力は JST に換算してから書く。生の UTC を写すときは、同じ行に JST を添える (共通ルール「会話中で日時を報告するときはJST」)。該当の行: ${line.trim().slice(0, 120)}`,
	},
}));
