// Every visit plays the newest release. tools/build_web.sh stamps each build's version,
// its commit, into the page (window.WILDS_BUILD) and into version.txt beside it, and the
// host lets a browser keep a file ten minutes without asking again. So every file the
// page and the game fetch from the site asks for this build by name, as
// "index.pck?v=4227c35", which no browser kept from an older release; and a page older
// than the site's version.txt, kept from before a release, goes once to the newest
// release's address, where nothing is kept yet, so the notes and the game always come
// from the same release.
//
// The core is pure, for node --test (fresh.test.js): which addresses carry the version,
// and where a page goes, if anywhere, given the newest one.
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.WildsFresh = factory().install(root);
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	// A build's version: its commit, as git abbreviates it.
	const VERSION = /^[0-9a-f]{7,40}$/;

	// Wraps the page's fetch so each of the site's files it fetches asks for this build,
	// then asks version.txt, past every cache, for the newest release, and goes to it if
	// this page is older. A page that isn't a stamped build fetches as it always has.
	function install(win) {
		const build = win.WILDS_BUILD;
		if (!VERSION.test(build || '')) return api;
		const fetch = win.fetch.bind(win);
		win.fetch = (input, options) => {
			if (typeof input !== 'string' && !(input instanceof URL)) return fetch(input, options);
			return fetch(versioned(input, build, win.location.href).href, options);
		};
		fetch(new URL('version.txt?t=' + Date.now(), win.location.href).href, { cache: 'no-store' })
			.then((response) => (response.ok ? response.text() : ''))
			.then((text) => {
				const next = newer(win.location.href, build, text.trim());
				if (next) win.location.replace(next);
			})
			.catch(() => {});
		return api;
	}

	// `address` as a URL, asking for `build` if it's one of the site's own files, in the
	// folder of the page at `page` or under it, and doesn't already ask for something.
	function versioned(address, build, page) {
		const url = new URL(address, page);
		const home = new URL('.', page);
		if (url.origin !== home.origin || !url.pathname.startsWith(home.pathname) || url.search) return url;
		url.searchParams.set('v', build);
		return url;
	}

	// The newest release's address, for the page at `href` built as `build`, with its own
	// options kept; null when this page is the newest, when `latest` isn't a version (the
	// site not answering, say), or when this page is already the one it went to, so a page
	// never goes round in a loop.
	function newer(href, build, latest) {
		if (!VERSION.test(latest) || latest === build) return null;
		const url = new URL(href);
		if (url.searchParams.get('v') === latest) return null;
		url.searchParams.set('v', latest);
		return url.href;
	}

	const api = { install, versioned, newer, VERSION };
	return api;
});
