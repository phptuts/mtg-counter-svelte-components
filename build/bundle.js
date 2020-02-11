var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /* src/Player.svelte generated by Svelte v3.17.2 */

    function create_if_block(ctx) {
    	let h2;
    	let t0;
    	let t1;

    	return {
    		c() {
    			h2 = element("h2");
    			t0 = text(/*playerName*/ ctx[2]);
    			t1 = text(" Wins");
    		},
    		m(target, anchor) {
    			insert(target, h2, anchor);
    			append(h2, t0);
    			append(h2, t1);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*playerName*/ 4) set_data(t0, /*playerName*/ ctx[2]);
    		},
    		d(detaching) {
    			if (detaching) detach(h2);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div;
    	let h2;
    	let t0;
    	let t1;
    	let button0;
    	let t3;
    	let button1;
    	let t5;
    	let dispose;
    	let if_block = /*won*/ ctx[1] && create_if_block(ctx);

    	return {
    		c() {
    			div = element("div");
    			h2 = element("h2");
    			t0 = text(/*points*/ ctx[0]);
    			t1 = space();
    			button0 = element("button");
    			button0.textContent = "+";
    			t3 = space();
    			button1 = element("button");
    			button1.textContent = "-";
    			t5 = space();
    			if (if_block) if_block.c();
    			attr(button0, "class", "plus svelte-1b68oo");
    			attr(button1, "class", "minus svelte-1b68oo");
    			set_style(div, "color", /*fontColor*/ ctx[3]);
    			attr(div, "class", "player svelte-1b68oo");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, h2);
    			append(h2, t0);
    			append(div, t1);
    			append(div, button0);
    			append(div, t3);
    			append(div, button1);
    			append(div, t5);
    			if (if_block) if_block.m(div, null);

    			dispose = [
    				listen(button0, "click", /*plus*/ ctx[4]),
    				listen(button1, "click", /*minus*/ ctx[5])
    			];
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*points*/ 1) set_data(t0, /*points*/ ctx[0]);

    			if (/*won*/ ctx[1]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*fontColor*/ 8) {
    				set_style(div, "color", /*fontColor*/ ctx[3]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { points } = $$props;
    	let { won } = $$props;
    	let { playerName } = $$props;
    	let { fontColor } = $$props;
    	const dispatch = createEventDispatcher();

    	function plus() {
    		dispatch("points", {
    			score: 1,
    			player: playerName.toLowerCase()
    		});
    	}

    	function minus() {
    		dispatch("points", {
    			score: -1,
    			player: playerName.toLowerCase()
    		});
    	}

    	$$self.$set = $$props => {
    		if ("points" in $$props) $$invalidate(0, points = $$props.points);
    		if ("won" in $$props) $$invalidate(1, won = $$props.won);
    		if ("playerName" in $$props) $$invalidate(2, playerName = $$props.playerName);
    		if ("fontColor" in $$props) $$invalidate(3, fontColor = $$props.fontColor);
    	};

    	return [points, won, playerName, fontColor, plus, minus];
    }

    class Player extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			points: 0,
    			won: 1,
    			playerName: 2,
    			fontColor: 3
    		});
    	}
    }

    /* src/App.svelte generated by Svelte v3.17.2 */

    function create_fragment$1(ctx) {
    	let div1;
    	let h1;
    	let t1;
    	let div0;
    	let t2;
    	let t3;
    	let button;
    	let current;
    	let dispose;

    	const player0 = new Player({
    			props: {
    				fontColor: "red",
    				playerName: "Red",
    				won: /*redWon*/ ctx[3],
    				points: /*redPlayerPoints*/ ctx[0]
    			}
    		});

    	player0.$on("points", /*updateScore*/ ctx[5]);

    	const player1 = new Player({
    			props: {
    				fontColor: "blue",
    				playerName: "Blue",
    				won: /*blueWon*/ ctx[2],
    				points: /*bluePlayerPoints*/ ctx[1]
    			}
    		});

    	player1.$on("points", /*updateScore*/ ctx[5]);

    	return {
    		c() {
    			div1 = element("div");
    			h1 = element("h1");
    			h1.textContent = "Magic The Gather Game Counter";
    			t1 = space();
    			div0 = element("div");
    			create_component(player0.$$.fragment);
    			t2 = space();
    			create_component(player1.$$.fragment);
    			t3 = space();
    			button = element("button");
    			button.textContent = "Start Game";
    			attr(div0, "id", "controls-container");
    			attr(div0, "class", "svelte-47img0");
    			attr(button, "id", "start_game");
    			attr(button, "class", "svelte-47img0");
    			attr(div1, "id", "container");
    			attr(div1, "class", "svelte-47img0");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			append(div1, h1);
    			append(div1, t1);
    			append(div1, div0);
    			mount_component(player0, div0, null);
    			append(div0, t2);
    			mount_component(player1, div0, null);
    			append(div1, t3);
    			append(div1, button);
    			current = true;
    			dispose = listen(button, "click", /*startGame*/ ctx[4]);
    		},
    		p(ctx, [dirty]) {
    			const player0_changes = {};
    			if (dirty & /*redWon*/ 8) player0_changes.won = /*redWon*/ ctx[3];
    			if (dirty & /*redPlayerPoints*/ 1) player0_changes.points = /*redPlayerPoints*/ ctx[0];
    			player0.$set(player0_changes);
    			const player1_changes = {};
    			if (dirty & /*blueWon*/ 4) player1_changes.won = /*blueWon*/ ctx[2];
    			if (dirty & /*bluePlayerPoints*/ 2) player1_changes.points = /*bluePlayerPoints*/ ctx[1];
    			player1.$set(player1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(player0.$$.fragment, local);
    			transition_in(player1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(player0.$$.fragment, local);
    			transition_out(player1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			destroy_component(player0);
    			destroy_component(player1);
    			dispose();
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let redPlayerPoints = 0;
    	let bluePlayerPoints = 0;

    	function startGame() {
    		$$invalidate(0, redPlayerPoints = 20);
    		$$invalidate(1, bluePlayerPoints = 20);
    	}

    	function updateScore(event) {
    		const { player, score } = event.detail;

    		if (noGame || redWon || blueWon) {
    			return;
    		}

    		if (player == "red") {
    			$$invalidate(0, redPlayerPoints += score);
    			return;
    		}

    		$$invalidate(1, bluePlayerPoints += score);
    	}

    	let blueWon;
    	let redWon;
    	let noGame;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*redPlayerPoints, bluePlayerPoints*/ 3) {
    			 $$invalidate(2, blueWon = redPlayerPoints <= 0 && bluePlayerPoints > 0);
    		}

    		if ($$self.$$.dirty & /*bluePlayerPoints, redPlayerPoints*/ 3) {
    			 $$invalidate(3, redWon = bluePlayerPoints <= 0 && redPlayerPoints > 0);
    		}

    		if ($$self.$$.dirty & /*bluePlayerPoints, redPlayerPoints*/ 3) {
    			 noGame = bluePlayerPoints == 0 && redPlayerPoints == 0;
    		}
    	};

    	return [redPlayerPoints, bluePlayerPoints, blueWon, redWon, startGame, updateScore];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
