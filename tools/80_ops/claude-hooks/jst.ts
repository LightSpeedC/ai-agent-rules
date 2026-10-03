// 2 つのフックが共有する、JST の日時の扱い。
// node でも bun でも動くよう、標準モジュールだけで書く。

// JST の日時を yyyy/mm/dd hh:mm:ss.ccc で返す。実行環境のタイムゾーンに依らない
export function jstNow(now: number = Date.now()): string {
	return new Date(now + 9 * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', '').replaceAll('-', '/');
}

// 表示の文言の先頭の絵文字の直後に、日付（月/日）と時刻（時:分）を入れる。いつの結果かが、画面だけで分かるようにするため。
// 例: 「✅ Obsidian メモリを注入した」→「✅10/04 00:50 Obsidian メモリを注入した」
// 先頭が絵文字でない文言（最初の空白より前が絵文字とは限らない場合）は、先頭に日時を付ける。
export function stamped(message: string, now: number = Date.now()): string {
	const t = jstNow(now); // 2026/10/04 00:50:12.345
	const stamp = `${t.slice(5, 10)} ${t.slice(11, 16)}`;
	const i = message.indexOf(' ');
	return i < 0 ? `${stamp} ${message}` : `${message.slice(0, i)}${stamp}${message.slice(i)}`;
}
