'use strict';

const { ok, eq, summary, read, loadUtils } = require('./lib');

/*
 * The view is an AMD module, so it is loaded here with a hand-written LuCI
 * sandbox: just enough of view/dom/form/poll/rpc/uci/L to execute render()
 * and inspect the resulting widget tree without a browser. Promises are
 * replaced by a synchronous thenable so the whole suite stays linear.
 */

function Sync(value) {
	this.value = value;
}

Sync.prototype.then = function(onFulfilled, onRejected) {
	try {
		return new Sync(onFulfilled ? onFulfilled(this.value) : this.value);
	}
	catch (e) {
		if (onRejected)
			return new Sync(onRejected(e));
		throw e;
	}
};

Sync.prototype.catch = function(onRejected) {
	return this.then(undefined, onRejected);
};

function E(tag, attrs, children) {
	return {
		tag: tag,
		attrs: attrs || {},
		children: children == null ? [] : (Array.isArray(children) ? children : [ children ])
	};
}

function makeForm() {
	function Option(type, name, title, desc) {
		this.type = type;
		this.name = name;
		this.title = title;
		this.desc = desc;
		this.values = [];
		this.dependsOn = [];
		this.def = null;
		this.rmempty = true;
	}

	Option.prototype.value = function(value, label, desc) {
		this.values.push({ value: value, label: label, desc: desc });
		return this;
	};

	Option.prototype.depends = function(field, value) {
		if (field && typeof field === 'object') {
			for (const name of Object.keys(field))
				this.dependsOn.push({ name: name, value: field[name] });
		}
		else {
			this.dependsOn.push({ name: field, value: value });
		}

		return this;
	};

	function Section(type, config, section, title) {
		this.type = type;
		this.config = config;
		this.section = section;
		this.title = title;
		this.options = [];
		this.addremove = true;
	}

	Section.prototype.option = function(OptionType, name, title, desc) {
		const option = new OptionType(name, title, desc);
		this.options.push(option);
		return option;
	};

	function Map(config, title, desc) {
		this.config = config;
		this.title = title;
		this.desc = desc;
		this.sections = [];
	}

	Map.prototype.section = function(SectionType, config, section, title) {
		const node = new Section('section', config, section, title);
		this.sections.push(node);
		return node;
	};

	Map.prototype.render = function() {
		return new Sync(E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, this.title)
		]));
	};

	function ListValue(name, title, desc) { Option.call(this, 'ListValue', name, title, desc); }
	ListValue.prototype = Object.create(Option.prototype);

	function RichListValue(name, title, desc) {
		Option.call(this, 'RichListValue', name, title, desc);
	}
	RichListValue.prototype = Object.create(Option.prototype);

	function Flag(name, title, desc) { Option.call(this, 'Flag', name, title, desc); }
	Flag.prototype = Object.create(Option.prototype);

	return {
		Map: Map,
		NamedSection: 'NamedSection',
		ListValue: ListValue,
		RichListValue: RichListValue,
		Flag: Flag,
		maps: []
	};
}

function loadView(options) {
	options = options || {};

	const src = read('htdocs/luci-static/resources/view/turboacc.js');
	const appended = [];
	const polls = [];
	const form = makeForm();

	const document = {
		querySelector: function() { return null; },
		head: { appendChild: function(node) { appended.push(node); } }
	};

	const L = {
		resource: function(path) { return '/luci-static/resources/' + path; },
		bind: function(fn, ctx) { return fn.bind(ctx); },
		resolveDefault: function(promise, fallback) {
			if (promise instanceof Sync)
				return new Sync(promise.value == null ? fallback : promise.value);
			return new Sync(fallback);
		}
	};

	const uci = {
		get: function(config, section, option) {
			if (config === 'turboacc' && section === 'config' && option === 'fastpath')
				return options.fastpath;
			return null;
		}
	};

	const poll = {
		add: function(fn, interval) { polls.push({ fn: fn, interval: interval }); }
	};

	const rpc = {
		declare: function(decl) {
			return function() {
				return new Sync(decl.method === 'getStatus' ? options.status : options.features);
			};
		}
	};

	const view = { extend: function(props) { return props; } };
	const dom = {
		content: function(node, content) {
			node.children = Array.isArray(content) ? content : [ content ];
		}
	};

	const MapClass = form.Map;
	form.Map = function(config, title, desc) {
		const instance = new MapClass(config, title, desc);
		form.maps.push(instance);
		return instance;
	};
	form.Map.prototype = MapClass.prototype;

	const instance = new Function(
		'view', 'dom', 'form', 'poll', 'rpc', 'uci', 'L', 'E', 'document', '_', 'utils',
		src
	)(view, dom, form, poll, rpc, uci, L, E, document, function(s) { return s; }, loadUtils());

	return { view: instance, form: form, appended: appended, polls: polls, E: E };
}

function render(features, status, fastpath) {
	const env = loadView({ features: features, status: status, fastpath: fastpath });
	const page = env.view.render([ features, status ]).value;

	return { env: env, page: page, map: env.form.maps[0] };
}

function optionNames(section) {
	return section.options.map(function(o) { return o.name; });
}

function findOption(map, name) {
	for (const section of map.sections) {
		for (const option of section.options) {
			if (option.name === name)
				return option;
		}
	}

	return null;
}

function values(option) {
	return option ? option.values.map(function(v) { return v.value; }) : null;
}

const source = read('htdocs/luci-static/resources/view/turboacc.js');

ok(/^'use strict';$/m.test(source), 'view is strict');
ok(/'require view'/.test(source), 'view requires the LuCI view class');
ok(/'require turboacc\.utils as utils'/.test(source), 'view shares helpers with utils');
ok(!/'require fs'/.test(source), 'view does not touch the filesystem');
ok(!/luci\.sys|luci\.fs/.test(source), 'view has no Lua-specific APIs');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(source), 'view keeps colours out of JavaScript');

/* --- stock OpenWrt: firewall4 flow offloading only ------------------------ */

const stockFeatures = {
	offloading: true,
	offloading_hw: false,
	engines: {},
	cca: [ 'cubic' ],
	target: 'x86/64',
	arch: 'x86_64',
	kernel: '6.6.93'
};

const stockStatus = { engine: 'flow_offloading', hw: false, fullcone: '0', cca: 'cubic' };

const stock = render(stockFeatures, stockStatus, 'flow_offloading');

eq(stock.page.attrs['class'], 'turboacc-page', 'page wraps the map in a styled container');
eq(stock.page.children[0].attrs['class'], 'cbi-section turboacc-status', 'status card comes first');
eq(stock.page.children[1].attrs['class'], 'cbi-map', 'form map follows the status card');

eq(stock.env.appended.length, 1, 'stylesheet injected once');
eq(stock.env.appended[0].attrs.rel, 'stylesheet', 'stylesheet link has rel');
eq(stock.env.appended[0].attrs.href, '/luci-static/resources/view/turboacc/turboacc.css',
	'stylesheet points at the packaged css');
eq(stock.env.appended[0].attrs['data-turboacc-style'], '', 'stylesheet is tagged for dedupe');

eq(stock.env.polls.length, 1, 'status polling registered');
eq(stock.env.polls[0].interval, 5, 'status poll interval is five seconds');

eq(stock.map.sections.length, 2, 'stock system hides the full-cone section');
eq(stock.map.sections[0].title, 'Acceleration', 'first section is acceleration');
eq(optionNames(stock.map.sections[0]), [ 'fastpath' ], 'acceleration has only the engine selector');
eq(values(findOption(stock.map, 'fastpath')), [ 'disabled', 'flow_offloading' ],
	'stock system offers disabled and flow offloading only');
eq(stock.map.sections[1].title, 'TCP congestion control', 'third section is TCP congestion control');
eq(values(findOption(stock.map, 'tcpcca')), [ 'cubic' ], 'cca dropdown lists the available algorithms');

const card = stock.page.children[0];
eq(card.children[0].tag, 'h3', 'status card has a heading');
eq(card.children[0].children, [ 'Runtime status' ], 'status card heading text');
eq(card.children[1].tag, 'table', 'status card renders a table');
eq(card.children[1].children[0].children.length, 5, 'status card lists five rows');

const engineCell = card.children[1].children[0].children[0].children[1];
eq(engineCell.children[0].attrs['class'], 'turboacc-dot is-on', 'running engine shows a lit dot');
eq(engineCell.children[1].children, [ 'Flow offloading' ], 'engine row shows the engine name');

const hwCell = card.children[1].children[0].children[1].children[1];
eq(hwCell.children, [ 'Disabled' ], 'software-only offloading reports hardware disabled');

const platformCell = card.children[1].children[0].children[4].children[1];
eq(platformCell.children, [ 'x86/64 · x86_64 · 6.6.93' ], 'platform row joins target, arch and kernel');

const nftFullcone = render(stockFeatures,
	{ engine: 'flow_offloading', hw: false, fullcone: 'nft', cca: 'cubic' }, 'flow_offloading');
const fullconeCell = nftFullcone.page.children[0].children[1].children[0].children[2].children[1];
eq(fullconeCell.children, [ 'FULLCONENAT (nftables)' ],
	'status card understands the runtime full-cone mode names');

/* --- MediaTek: HNAT, WED and nftables full-cone --------------------------- */

const mediaTekFeatures = {
	offloading: true,
	offloading_hw: true,
	offloading_hw_ipv6: true,
	engines: { mediatek_hnat: true },
	fullcone_nft: true,
	fullcone_broadcom: false,
	wed: true,
	cca: [ 'cubic', 'bbr' ]
};

const mediaTek = render(mediaTekFeatures,
	{ engine: 'mediatek_hnat', hw: false, fullcone: '1', cca: 'bbr' }, 'mediatek_hnat');

eq(mediaTek.map.sections.length, 3, 'MediaTek system shows the full-cone section');
eq(mediaTek.map.sections.map(function(s) { return s.title; }),
	[ 'Acceleration', 'Full-cone NAT', 'TCP congestion control' ], 'section order');
eq(values(findOption(mediaTek.map, 'fastpath')),
	[ 'disabled', 'flow_offloading', 'mediatek_hnat' ], 'engine list includes HNAT');
eq(values(findOption(mediaTek.map, 'fastpath_fo_hw')), [], 'hardware offload is a flag');
eq(findOption(mediaTek.map, 'fastpath_fo_hw').dependsOn,
	[ { name: 'fastpath', value: 'flow_offloading' } ], 'hardware offload only applies to flow offloading');
eq(findOption(mediaTek.map, 'fastpath_fo_hw_ipv6').dependsOn,
	[ { name: 'fastpath_fo_hw', value: '1' } ], 'IPv6 hardware offload requires hardware offload');
eq(values(findOption(mediaTek.map, 'fastpath_fo_hw_ipv6')), [], 'IPv6 hardware offload is a flag');
eq(findOption(mediaTek.map, 'fastpath_mh_eth_hnat').dependsOn,
	[ { name: 'fastpath', value: 'mediatek_hnat' } ], 'HNAT flag only applies to HNAT');
eq(findOption(mediaTek.map, 'fastpath_mh_eth_hnat_v6').dependsOn,
	[ { name: 'fastpath_mh_eth_hnat', value: '1' } ], 'IPv6 HNAT requires ethernet HNAT');
eq(findOption(mediaTek.map, 'fastpath_mh_eth_hnat_wed').dependsOn,
	[ { name: 'fastpath', value: 'flow_offloading' }, { name: 'fastpath_fo_hw', value: '1' } ],
	'WED is offered for hardware flow offloading only');
eq(values(findOption(mediaTek.map, 'fullcone')), [ '0', '1' ],
	'full-cone offers nftables mode when fw4 supports it');
eq(values(findOption(mediaTek.map, 'tcpcca')), [ 'cubic', 'bbr' ], 'cca dropdown lists both algorithms');

/* --- engines not currently installable stay selectable -------------------- */

const retained = render({ offloading: true, engines: {} }, {}, 'shortcut_fe_cm');

eq(values(findOption(retained.map, 'fastpath')),
	[ 'disabled', 'flow_offloading', 'shortcut_fe_cm' ],
	'a configured engine stays selectable when its module is missing');

/* --- QCA NSS on a firmware without firewall4 flow offloading -------------- */

const qca = render({ offloading: false, engines: { qca_nss_ecm: true }, cca: [ 'cubic' ] }, {}, 'qca_nss_ecm');

eq(values(findOption(qca.map, 'fastpath')), [ 'disabled', 'qca_nss_ecm' ],
	'engine list adapts when flow offloading is unavailable');

/* --- stylesheet: theme neutral and dark-mode aware ------------------------ */

const css = read('htdocs/luci-static/resources/view/turboacc/turboacc.css');

ok(css.includes(':root[data-darkmode="true"]'), 'dark rules cover luci-theme-bootstrap');
ok(css.includes(':root[data-argon-mode="dark"]'), 'dark rules cover luci-theme-argon 3.x');
ok(/prefers-color-scheme:\s*dark/.test(css), 'dark rules honour the system preference');
ok(/:not\(\[data-argon-mode="light"\]\)/.test(css),
	'system preference does not override an explicit argon light choice');
ok(/:not\(\[data-darkmode="false"\]\)/.test(css),
	'system preference does not override an explicit bootstrap light choice');
ok(!/!important/.test(css), 'stylesheet never forces values with !important');
ok(!/^\s*body\s*\{/m.test(css), 'stylesheet does not restyle the page body');
ok(!/\bbackground-color\s*:/.test(css), 'stylesheet leaves page backgrounds to the theme');

summary('view.test.js');
