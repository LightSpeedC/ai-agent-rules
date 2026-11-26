// 勉強会の読み物 (docs/) の共通 JS。矢印キーで、前の資料・次の資料へ進む。
// 旗 (いまここ) と目次は、HTML と CSS だけで出す。この JS が無効でも、読める。
(function (global) {
	'use strict';

	// 横にスクロールできる pre・表の枠の中か。そこでは ← → をスクロールに譲る。
	function inScroller(el) {
		while (el) {
			var tag = String(el.tagName || '').toUpperCase();
			var isBox = tag === 'PRE' || /(^|\s)tablewrap(\s|$)/.test(String(el.className || ''));
			if (isBox && el.scrollWidth > el.clientWidth) return true;
			el = el.parentElement;
		}
		return false;
	}

	// キーの押下から、行き先を決める。動かないときは null。
	function keyTarget(e, links) {
		if (!e || !links) return null;
		if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
		if (e.defaultPrevented || e.repeat || e.isComposing) return null;
		var t = e.target;
		if (t) {
			var tag = String(t.tagName || '').toUpperCase();
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return null;
			if (inScroller(t)) return null;
		}
		if (e.key === 'ArrowRight') return links.next || null;
		if (e.key === 'ArrowLeft') return links.prev || null;
		return null;
	}

	// ページに結びつける。前・次のリンクは、rel="prev"・rel="next" の a 要素から取る。
	function init(doc, loc) {
		function link(rel) {
			var a = doc.querySelector('a[rel~="' + rel + '"]');
			return a ? a.getAttribute('href') : null;
		}
		doc.addEventListener('keydown', function (e) {
			var to = keyTarget(e, { prev: link('prev'), next: link('next') });
			if (to) {
				if (e.preventDefault) e.preventDefault();
				loc.href = to;
			}
		});
	}

	global.StudyNav = { keyTarget: keyTarget, init: init };
	if (global.document && global.location) init(global.document, global.location);
})(typeof window !== 'undefined' ? window : this);
