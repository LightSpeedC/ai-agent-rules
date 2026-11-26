import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDocs, hue } from '../tools/20_build/build-docs.ts';

// 課題 i261126-01: 勉強会の読み物 (docs/) の、機械で決まる部分 (前へ・次へ・目次・章の色・旗) を書き込む道具。
// 守る動き: 何度流しても同じ・色相は 280 から 0 へ等間隔・最初に前へが無い・最後に次へが無い・BOM を保つ・章の数で色を割る。
const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'tmp', `build-docs-test-${process.pid}`);

function page(title: string, chapters: string[]): string {
	const secs = chapters.map((c, i) => `<section class="ch0${i + 1}" id="ch0${i + 1}">\n<h1>${c}</h1>\n<p>x</p>\n</section>`).join('\n');
	return `<!DOCTYPE html>\n<html><head><style>\n/* AUTO:style */\nold\n/* /AUTO:style */\n</style></head><body>\n<!-- AUTO:roadmap -->\n<!-- /AUTO:roadmap -->\n` +
		`<div class="titlebar"><div class="inner"><h1>${title}</h1></div></div>\n<div class="wrap">\n<!-- AUTO:nav --><!-- /AUTO:nav -->\n<!-- AUTO:toc -->\n<!-- /AUTO:toc -->\n${secs}\n</div>\n<footer><!-- AUTO:nav --><!-- /AUTO:nav --></footer></body></html>\n`;
}
const read = (f: string) => readFileSync(join(dir, f), 'utf8');

describe('hue (色相)', () => {
	test('9 個なら 280 から 0 まで 35 刻み', () => {
		assert.deepEqual(Array.from({ length: 9 }, (_, i) => hue(i, 9)), [280, 245, 210, 175, 140, 105, 70, 35, 0]);
	});
	test('4 個なら 280・186.7・93.3・0', () => {
		assert.deepEqual(Array.from({ length: 4 }, (_, i) => hue(i, 4)), [280, 186.7, 93.3, 0]);
	});
	test('1 個なら 280', () => {
		assert.equal(hue(0, 1), 280);
	});
});

describe('buildDocs', () => {
	before(() => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, '01-はじめ.html'), '﻿' + page('01. はじめ', ['一つ目', '二つ目', '三つ目']));
		writeFileSync(join(dir, '02-つぎ.html'), '﻿' + page('02. つぎ', ['A', 'B']));
		writeFileSync(join(dir, '03-おわり.html'), '﻿' + page('03. おわり', ['X']));
	});
	after(() => rmSync(dir, { recursive: true, force: true }));

	test('書き込めて、2 回目は何も書き換えない (何度流しても同じ)', () => {
		const a = buildDocs(dir);
		assert.equal(a.docs, 3);
		assert.equal(a.changed, 3);
		const before = ['01-はじめ.html', '02-つぎ.html', '03-おわり.html'].map(read);
		const b = buildDocs(dir);
		assert.equal(b.changed, 0);
		assert.deepEqual(['01-はじめ.html', '02-つぎ.html', '03-おわり.html'].map(read), before);
	});
	test('BOM を保つ', () => {
		assert.equal(read('01-はじめ.html').charCodeAt(0), 0xfeff);
	});
	test('最初の資料は、前へが無く、次へと目次がある (上下とも)', () => {
		const h = read('01-はじめ.html');
		const navs = [...h.matchAll(/<!-- AUTO:nav -->(.*?)<!-- \/AUTO:nav -->/g)].map((m) => m[1]);
		assert.equal(navs.length, 2);
		assert.equal(navs[0], navs[1]);
		assert.doesNotMatch(navs[0], /rel="prev"/);
		assert.match(navs[0], /rel="next" href="02-つぎ\.html"/);
		assert.match(navs[0], /class="doclink home" href="\.\.\/README\.html"/);
	});
	test('最後の資料は、次へが無く、前へと目次がある', () => {
		const h = read('03-おわり.html');
		const nav = /<!-- AUTO:nav -->(.*?)<!-- \/AUTO:nav -->/.exec(h)![1];
		assert.match(nav, /rel="prev" href="02-つぎ\.html"/);
		assert.doesNotMatch(nav, /rel="next"/);
	});
	test('前へ・次へのバッジの色は、行き先の資料の通し色相 (3 本: 280・140・0)', () => {
		const h = read('02-つぎ.html');
		assert.match(h, /rel="prev" href="01-はじめ\.html"[^>]*--accent:hsl\(280,/);
		assert.match(h, /rel="next" href="03-おわり\.html"[^>]*--accent:hsl\(0,/);
		assert.match(read('01-はじめ.html'), /rel="next" href="02-つぎ\.html"[^>]*--accent:hsl\(140,/);
	});
	test('章の色は、そのページの章の数で割る (3 章 280・140・0 / 2 章 280・0 / 1 章 280)', () => {
		const css = (f: string) => /\/\* AUTO:style \*\/([\s\S]*?)\/\* \/AUTO:style \*\//.exec(read(f))![1];
		assert.match(css('01-はじめ.html'), /\.ch01\{--accent:hsl\(280,.*\.ch02\{--accent:hsl\(140,.*\.ch03\{--accent:hsl\(0,/s);
		assert.match(css('02-つぎ.html'), /\.ch01\{--accent:hsl\(280,.*\.ch02\{--accent:hsl\(0,/s);
		assert.match(css('03-おわり.html'), /\.ch01\{--accent:hsl\(280,/);
	});
	test('章番号は CSS カウンタで、資料番号が前に付く', () => {
		const h = read('02-つぎ.html');
		assert.match(h, /section h1::before\{content:"02\." counter\(secnum\) " ";\}/);
		assert.match(h, /\.toc ol a::before\{content:"02\." counter\(tocnum\) " ";\}/);
	});
	test('目次は、章の h1 から作る', () => {
		const h = read('01-はじめ.html');
		assert.match(h, /<li class="ch01"><a href="#ch01">一つ目<\/a><\/li>/);
		assert.match(h, /<li class="ch03"><a href="#ch03">三つ目<\/a><\/li>/);
	});
	test('旗は、本編の全駅を並べ、このページの駅にだけ印 (here・aria-current) を付ける', () => {
		const h = read('02-つぎ.html');
		const nav = /<!-- AUTO:roadmap -->([\s\S]*?)<!-- \/AUTO:roadmap -->/.exec(h)![1];
		const stations = [...nav.matchAll(/<a class="station( here)?" href="(.*?)"/g)];
		assert.deepEqual(stations.map((m) => m[2]), ['01-はじめ.html', '02-つぎ.html', '03-おわり.html']);
		assert.deepEqual(stations.map((m) => !!m[1]), [false, true, false]);
		assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
	});
	test('駅の色は、色だけの地 (background:hsl) を style に直書きする (var() だけにしない)', () => {
		const h = read('01-はじめ.html');
		assert.match(h, /<a class="station[^"]*" href="[^"]+"[^>]*style="background:hsl\(/);
	});
	test('旗の駅に、読み上げ用の名前 (aria-label) が付く。いまここは、そう分かる', () => {
		const h = read('02-つぎ.html');
		assert.match(h, /aria-label="02\. つぎ \(いまここ\)"/);
		assert.match(h, /aria-label="01\. はじめ"/);
	});
	test('途中の資料が壊れていても、先の資料は書き換わらない (全部できてから書く)', () => {
		const d2 = join(root, 'tmp', `build-docs-test2-${process.pid}`);
		mkdirSync(d2, { recursive: true });
		try {
			writeFileSync(join(d2, '01-a.html'), page('01. a', ['一']));
			writeFileSync(join(d2, '02-b.html'), page('02. b', ['二']));
			writeFileSync(join(d2, '03-c.html'), '<html><body><div class="titlebar"><div class="inner"><h1>03. c</h1></div></div></body></html>');
			const b1 = readFileSync(join(d2, '01-a.html'), 'utf8');
			const b2 = readFileSync(join(d2, '02-b.html'), 'utf8');
			assert.throws(() => buildDocs(d2));
			assert.equal(readFileSync(join(d2, '01-a.html'), 'utf8'), b1);
			assert.equal(readFileSync(join(d2, '02-b.html'), 'utf8'), b2);
		} finally {
			rmSync(d2, { recursive: true, force: true });
		}
	});
	test('目次の印 (AUTO:toc) が無い資料も、止まって知らせる', () => {
		const d3 = join(root, 'tmp', `build-docs-test3-${process.pid}`);
		mkdirSync(d3, { recursive: true });
		try {
			writeFileSync(join(d3, '01-a.html'), page('01. a', ['一']).replace(/<!-- AUTO:toc -->\n<!-- \/AUTO:toc -->\n/, ''));
			assert.throws(() => buildDocs(d3), /<!-- AUTO:toc --> が見つかりません: 01-a\.html/);
		} finally {
			rmSync(d3, { recursive: true, force: true });
		}
	});
	test('印が片方だけ (開始だけ・終了だけ) のときは、「対になっていない」と知らせる', () => {
		const d4 = join(root, 'tmp', `build-docs-test4-${process.pid}`);
		mkdirSync(d4, { recursive: true });
		try {
			writeFileSync(join(d4, '01-a.html'), page('01. a', ['一']).replace('<!-- /AUTO:toc -->', ''));
			assert.throws(() => buildDocs(d4), /対になっていません: <!-- AUTO:toc --> 01-a\.html/);
		} finally {
			rmSync(d4, { recursive: true, force: true });
		}
	});
	test('印 (AUTO:nav) が無い資料は、止まって知らせる', () => {
		writeFileSync(join(dir, '04-壊れ.html'), '<html><body><div class="titlebar"><div class="inner"><h1>04. 壊れ</h1></div></div></body></html>');
		assert.throws(() => buildDocs(dir), /<!-- AUTO:nav --> が見つかりません: 04-壊れ\.html/);
		rmSync(join(dir, '04-壊れ.html'));
	});
});
