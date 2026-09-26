// The title screen's sound (shell.html). The forest waits, hushed, behind PRESS START:
// the first press of a key, the pointer or a controller's button (pad.js) opens the
// gate, and with it the page's sound, which a browser holds back until the player
// presses something (MDN's autoplay guide for media and Web Audio). The reveal plays,
// and on the frame the sword stops dead its shiiiing rings out; once the ring has
// sounded on its own, the title theme's fanfare swells in once, then its march loops
// until the game starts, when it fades away. The Sound window's sliders set both as they set the
// game's music and effects, live, and the theme dips a little under the other windows.
//
// Where sound can't play, without Web Audio or after a controller's press the browser
// doesn't count as the player's own (Safari's and Firefox's), the title plays on in
// silence, and the next key, click or tap brings the theme in. Both sounds are
// tools/generate_title_sounds.py's.
//
// The core runs under node --test (title-sound.test.js), on a fake window and Web Audio.
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.WildsTitleSound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	// The sounds, and where the theme loops, in seconds of its file: from a bar into the
	// march round to the same place the next time (generate_title_sounds.py's LOOP_START
	// and LOOP_END).
	const SHING = 'title-shing.mp3';
	const THEME = 'title-theme.mp3';
	const LOOP_START = 10;
	const LOOP_END = 58;
	// The fanfare comes in THEME_AFTER seconds after the shing, once its ring has sounded on
	// its own through the shine and the star, as the menu finishes fading up. A shing still
	// loading, or waiting on the browser, may ring up to SHING_LATE seconds after the sword
	// lands; after that it would miss it, and doesn't.
	const THEME_AFTER = 1.5;
	const SHING_LATE = 0.25;
	// The game's own mix (audio.gd): its score plays 5 dB under the Music slider and its
	// effects 8 dB under the Effects slider, which start at 55% and 75%.
	const MIX = { music: 0.56, effects: 0.4 };
	const LEVELS = { music: 0.55, effects: 0.75 };
	// Under a window, the theme dips to DUCK. A level glides to a new one with a time
	// constant of SMOOTH seconds, and the theme fades out over FADE as the game starts.
	const DUCK = 0.5;
	const SMOOTH = 0.05;
	const FADE = 1.5;
	// A decoder may leave silence ahead of an MP3's first sample: the sound starts at its
	// first sample above ONSET of full scale, within MAX_LEAD seconds.
	const ONSET = 0.02;
	const MAX_LEAD = 0.1;
	// The presses the title answers, and the events a browser counts as the player's own,
	// from which sound may start (html.spec.whatwg.org, activation-triggering events).
	const PRESSES = ['keydown', 'pointerdown', 'wilds-pad'];
	const ACTIVATIONS = ['keydown', 'mousedown', 'pointerup', 'touchend', 'click'];
	const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Fn', 'CapsLock', 'NumLock', 'ScrollLock']);
	// The title hears them first, ahead of the page (pad.js) and the game.
	const CAPTURE = { capture: true };

	// The title's sound in `win`, silent until unlock(), from the press at PRESS START.
	function create(win) {
		const Context = win.AudioContext || win.webkitAudioContext;
		const activation = win.navigator && win.navigator.userActivation;
		const levels = { music: saved(win, 'music'), effects: saved(win, 'effects') };
		const loads = {};
		const buffers = {};
		const events = [];
		let context = null;
		let buses = null;
		let asked = false;
		let landed = null;
		let shingAt = null;
		let shingDone = false;
		let theme = null;
		let ducked = false;
		let over = false;

		// The sounds load once the title has painted, so it never waits on them.
		if (Context && win.fetch) afterPaint(win, () => {
			load(SHING);
			load(THEME);
		});
		// Where the press at PRESS START couldn't wake the sound, the next that can does;
		// and a hidden page rests its sound until it shows again.
		for (const type of ACTIVATIONS) win.addEventListener(type, retry, CAPTURE);
		win.document.addEventListener('visibilitychange', rest);

		return { unlock, land, level, duck, fadeOut, events };

		// From within a press: makes the title's audio, which a browser lets start only from
		// a press it counts as the player's own, and wakes it.
		function unlock() {
			asked = true;
			if (over || !Context) return;
			if (!context) {
				if (activation && !activation.isActive) return;
				try {
					context = new Context();
				} catch (error) {
					over = true;
					return;
				}
				buses = { music: bus('music'), effects: bus('effects') };
				context.addEventListener('statechange', changed);
				note('unlock');
				decode(SHING);
				decode(THEME);
			}
			if (context.state !== 'running') {
				quietly(context.resume());
				tickle();
			}
		}

		// The sword has landed: its shing rings now, as far as its sound allows, and the
		// theme follows it.
		function land() {
			if (landed !== null) return;
			landed = win.performance.now();
			note('land');
			update();
			if (!shingDone) win.setTimeout(update, SHING_LATE * 1000 + 20);
		}

		// The Sound window's `kind` slider, music or effects, moved to `value`, 0 to 1.
		function level(kind, value) {
			if (!(kind in levels) || !Number.isFinite(Number(value))) return;
			levels[kind] = clamp(Number(value));
			glide(kind);
		}

		// A window opened over the title, or closed: the theme dips under it, or comes back.
		function duck(on) {
			ducked = !!on;
			glide('music');
		}

		// The game is starting: the title's sound fades out over `seconds` and closes,
		// leaving the speakers to the game.
		function fadeOut(seconds = FADE) {
			if (over) return;
			over = true;
			for (const type of ACTIVATIONS) win.removeEventListener(type, retry, CAPTURE);
			win.document.removeEventListener('visibilitychange', rest);
			if (!context) return;
			note('fade');
			const now = context.currentTime;
			for (const kind in buses) {
				const gain = buses[kind].gain;
				gain.cancelScheduledValues(now);
				gain.setValueAtTime(gain.value, now);
				gain.linearRampToValueAtTime(0, now + seconds);
			}
			const close = () => context.close && quietly(context.close());
			if (theme && context.state === 'running') {
				theme.onended = close;
				theme.stop(now + seconds);
			} else win.setTimeout(close, seconds * 1000);
		}

		// Starts what's due once the sword has landed and the browser lets sound play: the
		// shing, while it can still ring with the sword, then the theme, each once loaded.
		function update() {
			if (over || landed === null || !context || context.state !== 'running') return;
			const since = (win.performance.now() - landed) / 1000;
			if (!shingDone) {
				if (since >= SHING_LATE || buffers[SHING] === null) {
					shingDone = true;
					note('missed');
				} else if (buffers[SHING]) {
					shingDone = true;
					shingAt = context.currentTime;
					play(buffers[SHING], buses.effects, shingAt, false);
					note('shing', shingAt);
				} else return;
			}
			if (theme || !buffers[THEME]) return;
			const due = shingAt !== null ? shingAt + THEME_AFTER : context.currentTime + Math.max(0, THEME_AFTER - since);
			const at = Math.max(due, context.currentTime);
			theme = play(buffers[THEME], buses.music, at, true);
			note('theme', at);
		}

		function play(buffer, to, at, loops) {
			const source = context.createBufferSource();
			const start = lead(buffer);
			source.buffer = buffer;
			if (loops) {
				source.loop = true;
				source.loopStart = start + LOOP_START;
				source.loopEnd = start + LOOP_END;
			}
			source.connect(to);
			source.start(at, start);
			return source;
		}

		function changed() {
			if (context.state === 'running') note('running');
			update();
		}

		function retry() {
			if (asked && !over && (!context || context.state !== 'running')) unlock();
		}

		function rest() {
			if (!context || over) return;
			quietly(win.document.hidden ? context.suspend() : context.resume());
		}

		function load(name) {
			if (!loads[name]) loads[name] = win.fetch(name).then((response) => (response.ok ? response.arrayBuffer() : null)).catch(() => null);
			return loads[name];
		}

		// Old Safari's decodeAudioData only calls back; the others also promise.
		function decode(name) {
			const decoding = win.fetch ? load(name) : Promise.resolve(null);
			decoding.then((bytes) => bytes && new Promise((done) => {
				try {
					quietly(context.decodeAudioData(bytes, done, () => done(null)));
				} catch (error) {
					done(null);
				}
			})).then((buffer) => {
				buffers[name] = buffer || null;
				update();
			});
		}

		function bus(kind) {
			const gain = context.createGain();
			gain.gain.value = target(kind);
			gain.connect(context.destination);
			return gain;
		}

		function glide(kind) {
			if (!buses || over) return;
			const gain = buses[kind].gain;
			gain.cancelScheduledValues(context.currentTime);
			gain.setTargetAtTime(target(kind), context.currentTime, SMOOTH);
		}

		function target(kind) {
			return levels[kind] * MIX[kind] * (kind === 'music' && ducked ? DUCK : 1);
		}

		// iOS's older Safari wakes a page's sound only once something plays from the press:
		// a sample of silence does.
		function tickle() {
			try {
				const source = context.createBufferSource();
				source.buffer = context.createBuffer(1, 1, context.sampleRate);
				source.connect(context.destination);
				source.start(0);
			} catch (error) {}
		}

		// What happened when, for the tests and a look in the browser's console.
		function note(what, when) {
			events.push({ what, at: win.performance.now(), when });
		}
	}

	// PRESS START: gives the first press (presses), or a click on `button`, to `open`, and
	// to nothing else. A key's press goes no further, and nor does a controller's, which
	// pad.js then leaves alone, so the menu's selection stays put. A pointer's goes on, for
	// its click lands on `button`, which covers the screen (shell.html). Returns what stops
	// the waiting.
	function gate(win, open, button) {
		const stop = presses(win, pass);
		if (button) button.addEventListener('click', pass);
		function pass(event) {
			done();
			if (event.type !== 'pointerdown') {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
			open(event);
		}
		function done() {
			stop();
			if (button) button.removeEventListener('click', pass);
		}
		return done;
	}

	// Calls `then` with each press the title answers: a key going down, but not one held on,
	// a modifier on its own or a shortcut; a pointer's press; and a controller's (pad.js's
	// wilds-pad), but not a held button's repeats. Returns what stops it.
	function presses(win, then) {
		const heard = (event) => {
			if (pressing(event)) then(event);
		};
		for (const type of PRESSES) win.addEventListener(type, heard, CAPTURE);
		return () => {
			for (const type of PRESSES) win.removeEventListener(type, heard, CAPTURE);
		};
	}

	function pressing(event) {
		if (event.type === 'keydown') return !event.repeat && !MODIFIERS.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey;
		if (event.type === 'wilds-pad') return !(event.detail && event.detail.repeat);
		return true;
	}

	// Calls `then` once, as the CSS animation `name` ends on `target` or inside it: on the
	// frame what it moves comes to rest (shell.html's sword, as its plunge stops dead).
	function watch(target, name, then) {
		const ended = (event) => {
			if (event.animationName !== name) return;
			target.removeEventListener('animationend', ended);
			then(event);
		};
		target.addEventListener('animationend', ended);
		return () => target.removeEventListener('animationend', ended);
	}

	// Seconds of silence a decoder left ahead of `buffer`'s sound, as some keep an MP3's.
	function lead(buffer) {
		const samples = buffer.getChannelData(0);
		const limit = Math.min(samples.length, Math.round(MAX_LEAD * buffer.sampleRate));
		for (let i = 0; i < limit; i++) if (Math.abs(samples[i]) >= ONSET) return i / buffer.sampleRate;
		return 0;
	}

	// The level the player last gave `kind`, as the Sound window's sliders and the game
	// keep it, or its starting level.
	function saved(win, kind) {
		try {
			const value = win.localStorage.getItem('wilds-' + kind);
			if (value !== null && value !== '' && Number.isFinite(Number(value))) return clamp(Number(value));
		} catch (error) {}
		return LEVELS[kind];
	}

	function afterPaint(win, then) {
		if (win.requestAnimationFrame) win.requestAnimationFrame(() => win.setTimeout(then));
		else win.setTimeout(then);
	}

	function quietly(promise) {
		if (promise && promise.catch) promise.catch(() => {});
	}

	function clamp(value) {
		return Math.max(0, Math.min(1, value));
	}

	return {
		create, gate, presses, watch, lead, saved,
		SHING, THEME, LOOP_START, LOOP_END, THEME_AFTER, SHING_LATE, MIX, LEVELS, DUCK, FADE, ONSET,
	};
});
