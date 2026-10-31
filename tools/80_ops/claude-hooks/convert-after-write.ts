// PostToolUse フック: Write で ps1・html・cmd・bat を書いた直後に、convert-encoding で文字コードと改行を揃える（依頼 #1672）。
// 共通ルール「ツールごとの文字コードの扱い」は Write の後の変換を人に任せていたが、守られずに ps1 の日本語が化けた。道具で揃える。
// 成功のときは何も出さない。失敗（SJIS に無い文字など）は、書き換えずに止まった旨を ❌ で表示する。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { spawnSync } from 'node:child_process';
import { basename, extname } from 'node:path';
import { readInput, masked, type HookInput } from './vault.ts';
import { stamped } from './jst.ts';

// 拡張子ごとの変換先（convert-encoding --to の指定）。cmd と bat はどちらも SJIS ＋ CRLF
const TARGET: Record<string, string> = { '.ps1': 'ps1', '.html': 'html', '.cmd': 'cmd', '.bat': 'cmd' };

const data = (await readInput()) as HookInput & { tool_name?: string; tool_input?: { file_path?: string } };
if (data.tool_name !== 'Write') process.exit(0);

const path = data.tool_input?.file_path;
if (typeof path !== 'string' || path === '' || path.includes('"')) process.exit(0);

const format = TARGET[extname(path).toLowerCase()];
if (format === undefined) process.exit(0);

// シェルを通すのは、convert-encoding が Windows では cmd の入り口になるため（vault.ts の safePush と同じ）
const r = spawnSync(`convert-encoding "${path}" --to ${format}`, { shell: true, encoding: 'utf8', timeout: 30000 });
if (r.status === 0) process.exit(0);

const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
const last = output.split(/\r?\n/).filter((line) => line.trim() !== '').pop() ?? '';
const reason = last ? masked(last) : (r.error ? '起動できない' : `終了コード ${r.status}`);
console.log(JSON.stringify({
	systemMessage: stamped(`❌ ${basename(path)} の文字コードを ${format} に揃えられなかった（書き換えなし）: ${reason}`),
}));
