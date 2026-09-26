// The title screen with a controller, as a console's menus work: the D-pad or the left
// stick moves the selection, held it moves on again after a pause, A chooses, B goes
// back and Start chooses too. The keyboard's arrows move the same selection. It shows,
// in a gold frame under a bobbing arrow (ui-toolkit.css), while a controller or the keys
// lead, and hides while a mouse or a finger does (data-lead on the page).
//
// The name box has a grid of letters, as A Link to the Past's: A types the letter the
// selection is on, B deletes one, and Start begins. A finger taps the letters, and the
// keyboard still types into the name.
//
// The core is pure, for node --test (pad.test.js): what a controller holds, the presses
// and repeats that makes, where a direction goes among rows of controls, and a name's
// letters. Once the game starts the canvas has the controllers, so the page stops
// listening (suspend) until the game closes (resume).
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.WildsPad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	// The standard mapping's buttons (w3c.github.io/gamepad): the face buttons, Start, and
	// the D-pad. The left stick counts once pushed past DEADZONE, along its main axis.
	const BUTTONS = { accept: 0, back: 1, start: 9, up: 12, down: 13, left: 14, right: 15 };
	const DEADZONE = 0.5;
	// A held direction moves on after REPEAT_DELAY, then every REPEAT_EVERY, in ms, as in
	// the game's menus (menu_cursor.gd).
	const REPEAT_DELAY = 350;
	const REPEAT_EVERY = 100;
	// A name, as the game keeps it (story_mode.gd): letters, spaces, apostrophes and
	// dashes, at most NAME_LENGTH of them. The name box starts on DEFAULT_NAME.
	const NAME_LENGTH = 12;
	const DEFAULT_NAME = 'Robin';
	const LETTERS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz'];
	// Pixels a text window scrolls for each step of the D-pad.
	const SCROLL_STEP = 48;
	const DIRECTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
	const MOVES = new Set(Object.values(DIRECTIONS));

	let win = null;
	let doc = null;
	let lead = 'keys';
	let polling = false;
	let suspended = false;
	// The name box still holds the name it opened with, which the first letter typed
	// replaces, as typing over the keyboard's selected name does.
	let fresh = false;
	const repeater = createRepeater();

	// Wires the title screen to controllers and the keyboard's arrows.
	function init(window) {
		win = window;
		doc = window.document;
		buildLetters();
		setLead(connected().length ? 'pad' : 'keys');
		// A controller shows itself with its first press (Safari's first, on an iPad), which
		// only wakes it: the selection shows, and the title's reveal ends.
		win.addEventListener('gamepadconnected', () => {
			setLead('pad');
			win.dispatchEvent(new Event('wilds-pad'));
			wake();
			poll();
		});
		win.addEventListener('keydown', onKey);
		win.addEventListener('pointerdown', () => setLead('pointer'), true);
		win.addEventListener('pointermove', (event) => {
			if (event.pointerType !== 'mouse' || Math.abs(event.movementX) + Math.abs(event.movementY) >= 2) setLead('pointer');
		}, true);
		doc.addEventListener('focusin', (event) => mark(event.target));
		for (const dialog of doc.querySelectorAll('dialog')) dialog.addEventListener('close', () => win.setTimeout(() => returnFrom(dialog)));
		if (nameField()) nameField().addEventListener('input', () => { fresh = false; });
		poll();
	}

	// The game has the controllers now: the page lets go of them.
	function suspend() {
		suspended = true;
	}

	// The game closed and the title screen is back: the page takes the controllers again.
	function resume() {
		suspended = false;
		poll();
	}

	// A dialog just opened: with a controller leading, the selection goes to its first
	// control, the name box's to Begin once it has a name. True if it did, so the page
	// knows not to put the keyboard's focus there instead.
	function opened(dialog) {
		if (dialog.id === 'name-dialog') fresh = true;
		if (lead !== 'pad') return false;
		focusOn(first(dialog));
		return true;
	}

	function setLead(value) {
		if (lead === value && doc.documentElement.dataset.lead === value) return;
		lead = value;
		doc.documentElement.dataset.lead = value;
	}

	// Polls the controllers each frame, while any is connected and the title screen shows.
	function poll() {
		if (polling || suspended || !connected().length) return;
		polling = true;
		repeater.reset();
		win.requestAnimationFrame(tick);
	}

	function tick(now) {
		const pads = connected();
		if (suspended || !pads.length) {
			polling = false;
			return;
		}
		const presses = repeater.update(heldBy(pads), now);
		if (presses.length) {
			// Any press ends the title's reveal at once, as a key or a tap does.
			win.dispatchEvent(new Event('wilds-pad'));
			setLead('pad');
		}
		for (const press of presses) act(press.control, press.repeat);
		win.requestAnimationFrame(tick);
	}

	function connected() {
		if (!win || !win.navigator.getGamepads) return [];
		return Array.from(win.navigator.getGamepads()).filter((pad) => pad && pad.connected !== false);
	}

	function heldBy(pads) {
		const all = new Set();
		for (const pad of pads) for (const control of held(pad)) all.add(control);
		return all;
	}

	// A controller that just woke with a press shows the selection where it would start.
	function wake() {
		const place = context();
		if (place && !selected(place)) focusOn(first(place));
	}

	// The keyboard's arrows move the selection as the D-pad does, but slide a slider,
	// move the name's caret and scroll a text window as they always have.
	function onKey(event) {
		if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Meta') setLead('keys');
		const place = context();
		if (!place) return;
		const target = event.target;
		const direction = DIRECTIONS[event.key];
		if (direction) {
			const across = direction === 'left' || direction === 'right';
			if (place.dataset.pad === 'scroll' || (across && (target.type === 'range' || target.type === 'text'))) return;
			event.preventDefault();
			act(direction, event.repeat);
			return;
		}
		if (place.id !== 'name-dialog' || !target.closest || !target.closest('.letters')) return;
		// On the letters the keys still type the name.
		if (event.key === 'Backspace') {
			event.preventDefault();
			erase();
		} else if (event.key.length === 1 && /[A-Za-z'-]/.test(event.key)) {
			event.preventDefault();
			type(event.key);
		}
	}

	// Does what `control` asks of the selection, `repeat` when it's held on.
	function act(control, repeat) {
		const place = context();
		if (!place) return;
		const at = selected(place);
		// With nothing selected, the first press shows where the selection starts.
		if (!at) {
			if (!repeat) focusOn(first(place));
			return;
		}
		if (control === 'accept' && !repeat) choose(place, at);
		else if (control === 'back') back(place, repeat);
		else if (control === 'start' && !repeat) begin(place, at);
		else if (MOVES.has(control)) step(place, at, control);
	}

	// A direction: slides a slider, scrolls a text window, or moves the selection.
	function step(place, at, direction) {
		const across = direction === 'left' || direction === 'right';
		if (across && at.type === 'range') return slide(at, direction === 'right' ? 1 : -1);
		if (!across && place.dataset.pad === 'scroll') {
			place.scrollBy(0, (direction === 'down' ? 1 : -1) * SCROLL_STEP);
			return;
		}
		const list = items(place).map((control) => ({ control, rect: control.getBoundingClientRect() }));
		const to = move(rowsOf(list), list.find((item) => item.control === at), direction);
		if (to && to.control !== at) focusOn(to.control);
	}

	// A chooses what's selected: a letter types, a button presses. The name box won't
	// begin without a name: it shakes instead.
	function choose(place, at) {
		if (at.type === 'range' || at.type === 'text') return;
		if (place.id === 'name-dialog' && at.type === 'submit' && !at.formNoValidate && !nameField().value.trim()) return shake(nameField());
		at.click();
	}

	// B deletes a letter of the name, or backs out of a dialog; held, it deletes on but
	// never leaves.
	function back(place, repeat) {
		if (place.id === 'name-dialog' && nameField().value) return erase();
		if (!repeat && place.tagName === 'DIALOG') place.close('cancel');
	}

	// Start begins the story from the name box, and chooses anywhere else.
	function begin(place, at) {
		if (place.id !== 'name-dialog') return choose(place, at);
		const go = doc.getElementById('story-go');
		if (!nameField().value.trim()) return shake(nameField());
		if (go.form.requestSubmit) go.form.requestSubmit(go);
		else go.click();
	}

	function slide(slider, sign) {
		const was = slider.value;
		slider.value = Number(slider.value) + sign * (Number(slider.step) || 1);
		if (slider.value === was) return;
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		slider.dispatchEvent(new Event('change', { bubbles: true }));
	}

	// Where the controller and the arrows act: the open dialog, else the title screen
	// while it shows; nowhere once the game has started.
	function context() {
		if (suspended || !doc) return null;
		const dialog = doc.querySelector('dialog[open]');
		if (dialog) return dialog;
		const start = doc.getElementById('start');
		return start && !start.hidden ? start : null;
	}

	// The controls the selection can go to in `place`: never a text field while a
	// controller leads, as its on-screen keyboard would cover the letters.
	function items(place) {
		return Array.from(place.querySelectorAll('button, input')).filter((control) =>
			!control.disabled && control.getClientRects().length > 0 && !(lead === 'pad' && control.type === 'text'));
	}

	function selected(place) {
		const focused = doc.activeElement;
		return items(place).includes(focused) ? focused : null;
	}

	// Where the selection starts in `place`: its first control, or in the name box,
	// Begin once there's a name and the first letter while there isn't.
	function first(place) {
		if (place.id === 'name-dialog') return nameField().value.trim() ? doc.getElementById('story-go') : place.querySelector('.letters button');
		return items(place)[0] || null;
	}

	function focusOn(control) {
		if (!control) return;
		control.focus({ preventScroll: true });
		mark(control);
		// A window's Back stays in sight at its foot (shell.html), so only what isn't in
		// sight scrolls to it.
		if (control.scrollIntoView) control.scrollIntoView({ block: 'nearest' });
	}

	// The selection's styles follow a class on what has focus, as :focus itself matches
	// only while the browser's window has focus too.
	function mark(control) {
		for (const old of doc.querySelectorAll('.selected')) if (old !== control) old.classList.remove('selected');
		if (control && control.classList) control.classList.add('selected');
	}

	// A dialog closed: with buttons leading, the selection goes back to what opened it.
	function returnFrom(dialog) {
		if (lead === 'pointer' || !context() || selected(context())) return;
		const opener = doc.getElementById({ 'help-dialog': 'help', 'sound-dialog': 'sound', 'news-dialog': 'news', 'name-dialog': 'play' }[dialog.id]);
		if (opener && !opener.disabled && !opener.hidden) focusOn(opener);
	}

	// The name box's grid: the letters, then a dash, an apostrophe, a space and Delete.
	function buildLetters() {
		const grid = doc.getElementById('name-letters');
		if (!grid) return;
		const cells = [];
		for (const row of LETTERS) for (const letter of row) cells.push(cell(letter, letter));
		cells.push(cell('-', '-'), cell("'", "'"), cell('Space', ' ', 'space'), cell('Delete', null, 'delete'));
		cells[0].tabIndex = 0;
		grid.append(...cells);
		grid.addEventListener('click', (event) => {
			const button = event.target.closest('button');
			if (!button) return;
			if (button.dataset.letter === undefined) erase();
			else type(button.dataset.letter);
		});
	}

	function cell(label, letter, kind) {
		const button = doc.createElement('button');
		button.type = 'button';
		button.textContent = label;
		button.tabIndex = -1;
		if (letter !== null) button.dataset.letter = letter;
		if (kind) button.className = kind;
		return button;
	}

	// Types `letter` on the end of the name; a full name shakes instead.
	function type(letter) {
		const field = nameField();
		const before = fresh ? '' : field.value;
		const name = typed(before, letter);
		if (name === before) return shake(field);
		fresh = false;
		field.value = name;
	}

	function erase() {
		const field = nameField();
		fresh = false;
		field.value = erased(field.value);
	}

	function nameField() {
		return doc.getElementById('hero-name');
	}

	// A gentle no: `control` shakes (shell.html).
	function shake(control) {
		control.classList.remove('shake');
		void control.offsetWidth;
		control.classList.add('shake');
	}

	// --- The pure core -------------------------------------------------------------

	// What `pad`, a Gamepad or anything shaped like one, holds: some of accept, back,
	// start, up, down, left and right. The stick counts along its main axis only.
	function held(pad) {
		const holding = new Set();
		const buttons = (pad && pad.buttons) || [];
		for (const control in BUTTONS) {
			const button = buttons[BUTTONS[control]];
			if (button && (button.pressed || button.value > 0.5)) holding.add(control);
		}
		const axes = (pad && pad.axes) || [];
		const x = axes[0] || 0;
		const y = axes[1] || 0;
		if (Math.max(Math.abs(x), Math.abs(y)) >= DEADZONE) {
			if (Math.abs(x) > Math.abs(y)) holding.add(x > 0 ? 'right' : 'left');
			else holding.add(y > 0 ? 'down' : 'up');
		}
		return holding;
	}

	// Turns what's held, frame by frame, into presses: one as a control goes down, then,
	// while it's held, a repeat after `delay` and every `every` ms after. What's already
	// held when a controller is first seen waits to be let go, so the press that wakes a
	// controller only wakes it.
	function createRepeater(delay = REPEAT_DELAY, every = REPEAT_EVERY) {
		let before = null;
		const due = new Map();
		return {
			update(holding, now) {
				const presses = [];
				if (before !== null) {
					for (const control of holding) {
						if (!before.has(control)) {
							presses.push({ control, repeat: false });
							due.set(control, now + delay);
						} else if (now >= due.get(control)) {
							presses.push({ control, repeat: true });
							// The pace holds, but a frame that came late never makes a burst.
							const next = due.get(control) + every;
							due.set(control, next > now ? next : now + every);
						}
					}
				} else {
					for (const control of holding) due.set(control, Infinity);
				}
				for (const control of due.keys()) if (!holding.has(control)) due.delete(control);
				before = new Set(holding);
				return presses;
			},
			reset() {
				before = null;
				due.clear();
			},
		};
	}

	// `items`, each with a `rect` ({left, top, width, height}), in the rows they read in:
	// top to bottom, each left to right. An item whose middle is level with a row's first
	// item joins its row.
	function rowsOf(items) {
		const rows = [];
		const sorted = items.slice().sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
		for (const item of sorted) {
			const middle = item.rect.top + item.rect.height / 2;
			const row = rows.find((line) => middle >= line[0].rect.top && middle <= line[0].rect.top + line[0].rect.height);
			if (row) row.push(item);
			else rows.push([item]);
		}
		for (const row of rows) row.sort((a, b) => a.rect.left - b.rect.left);
		return rows;
	}

	// Where `direction` goes from `current` among `rows`: along its row, or to the
	// nearest across the screen in the row over or under it. At an edge it stays. With
	// nothing current, it's the first.
	function move(rows, current, direction) {
		const r = rows.findIndex((row) => row.includes(current));
		if (r < 0) return rows.length ? rows[0][0] : null;
		const i = rows[r].indexOf(current);
		if (direction === 'left') return rows[r][Math.max(0, i - 1)];
		if (direction === 'right') return rows[r][Math.min(rows[r].length - 1, i + 1)];
		const next = r + (direction === 'down' ? 1 : -1);
		if (next < 0 || next >= rows.length) return current;
		return nearest(rows[next], middle(current));
	}

	function nearest(row, x) {
		return row.reduce((best, item) => (Math.abs(middle(item) - x) < Math.abs(middle(best) - x) ? item : best));
	}

	function middle(item) {
		return item.rect.left + item.rect.width / 2;
	}

	// `name` with `letter` typed on its end, while it has room and the letter is one a
	// name may hold.
	function typed(name, letter) {
		if (name.length >= NAME_LENGTH || !/^[A-Za-z0-9 '-]$/.test(letter)) return name;
		if (letter === ' ' && (!name || name.endsWith(' '))) return name;
		return name + letter;
	}

	function erased(name) {
		return name.slice(0, -1);
	}

	return {
		init, suspend, resume, opened,
		held, createRepeater, rowsOf, move, typed, erased,
		BUTTONS, DEADZONE, REPEAT_DELAY, REPEAT_EVERY, NAME_LENGTH, DEFAULT_NAME, LETTERS,
	};
});
