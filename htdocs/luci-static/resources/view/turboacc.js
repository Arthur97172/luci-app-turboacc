'use strict';
'require view';
'require dom';
'require form';
'require poll';
'require rpc';
'require uci';
'require turboacc.utils as utils';

var callFeatures = rpc.declare({
	object: 'luci.turboacc',
	method: 'getSystemFeatures',
	expect: { '': {} }
});

var callStatus = rpc.declare({
	object: 'luci.turboacc',
	method: 'getStatus',
	expect: { '': {} }
});

function engineTitle(engine) {
	switch (engine) {
	case 'flow_offloading':
		return _('Flow offloading');
	case 'fast_classifier':
		return _('Fast classifier (SFE)');
	case 'shortcut_fe_cm':
		return _('Shortcut-FE CM');
	case 'mediatek_hnat':
		return _('MediaTek HNAT');
	case 'qca_nss_ecm':
		return _('QCA NSS ECM');
	default:
		return _('Disabled');
	}
}

function engineDescription(engine) {
	switch (engine) {
	case 'flow_offloading':
		return _('Software or hardware flow offloading implemented by firewall4 (nftables).');
	case 'fast_classifier':
		return _('Shortcut-FE fast classifier kernel module. Not compatible with firewall4 flow offloading.');
	case 'shortcut_fe_cm':
		return _('Shortcut-FE connection manager kernel module.');
	case 'mediatek_hnat':
		return _('Vendor hardware NAT offload for MediaTek SoCs (mtkhnat).');
	case 'qca_nss_ecm':
		return _('Qualcomm NSS ECM acceleration daemon.');
	default:
		return _('No acceleration engine is used.');
	}
}

function fullconeTitle(mode) {
	switch (mode) {
	case '1':
	case 'nft':
		return _('FULLCONENAT (nftables)');
	case '2':
	case 'broadcom':
		return _('Broadcom full-cone NAT1');
	default:
		return _('Disabled');
	}
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callFeatures(), {}),
			L.resolveDefault(callStatus(), {}),
			L.resolveDefault(uci.load('turboacc'), null)
		]);
	},

	injectStylesheet: function() {
		if (document.querySelector('link[data-turboacc-style]'))
			return;

		document.head.appendChild(E('link', {
			'rel': 'stylesheet',
			'type': 'text/css',
			'href': L.resource('view/turboacc/turboacc.css'),
			'data-turboacc-style': ''
		}));
	},

	renderStatusCard: function(features) {
		var cells = {};

		function row(key, label, initial) {
			var value = E('td', { 'class': 'turboacc-status-value' }, initial || '-');

			cells[key] = value;

			return E('tr', {}, [
				E('th', { 'scope': 'row' }, label),
				value
			]);
		}

		var platform = [ features.target, features.arch, features.kernel ]
			.filter(function(part) { return !!part; })
			.join(' · ') || '-';

		var node = E('div', { 'class': 'cbi-section turboacc-status' }, [
			E('h3', {}, _('Runtime status')),
			E('table', { 'class': 'turboacc-status-table' }, [
				E('tbody', {}, [
					row('engine', _('Acceleration engine')),
					row('hw', _('Hardware offload')),
					row('fullcone', _('Full-cone NAT')),
					row('cca', _('TCP congestion control')),
					row('platform', _('Platform'), platform)
				])
			])
		]);

		return { node: node, cells: cells };
	},

	updateStatusCard: function(card, status) {
		var engine = status && status.engine ? status.engine : null;
		var engineText = engine ? engineTitle(engine) : _('Not running');

		if (engine === 'flow_offloading' && status.hw)
			engineText += ' · ' + _('Hardware');

		dom.content(card.cells.engine, [
			E('span', { 'class': 'turboacc-dot ' + (engine ? 'is-on' : 'is-off') }),
			E('span', { 'class': 'turboacc-engine' }, [ engineText ])
		]);

		dom.content(card.cells.hw,
			engine === 'flow_offloading' ? (status.hw ? _('Enabled') : _('Disabled')) : '—');

		dom.content(card.cells.fullcone, fullconeTitle(status && status.fullcone));

		dom.content(card.cells.cca,
			status && status.cca ? String(status.cca).toUpperCase() : _('Unknown'));
	},

	render: function(data) {
		var features = data[0] || {};
		var status = data[1] || {};

		if (!features.engines)
			features.engines = {};

		/* The package hard-depends on firewall4; be forgiving if rpcd has not
		 * picked up the plugin yet (e.g. right after installation). */
		if (features.offloading === undefined)
			features.offloading = true;

		if (!Array.isArray(features.cca) || !features.cca.length)
			features.cca = [ 'cubic' ];

		this.injectStylesheet();

		var current = uci.get('turboacc', 'config', 'fastpath') || 'disabled';
		var engines = utils.availableEngines(features, current);
		var ListValue = form.RichListValue || form.ListValue;

		var map = new form.Map('turboacc', _('TurboACC'),
			_('Accelerate forwarded traffic with flow offloading, vendor hardware NAT, full-cone NAT and TCP congestion control.'));

		var section = map.section(form.NamedSection, 'config', 'turboacc', _('Acceleration'));
		section.addremove = false;

		var option = section.option(ListValue, 'fastpath', _('Acceleration engine'));
		option.rmempty = false;

		engines.forEach(function(engine) {
			option.value(engine, engineTitle(engine), engineDescription(engine));
		});

		if (features.offloading_hw) {
			var foHw = section.option(form.Flag, 'fastpath_fo_hw', _('Hardware flow offloading'),
				_('Offload flows to the SoC flow table. Falls back to software offloading when the hardware cannot handle a flow.'));
			foHw.default = '0';
			foHw.depends('fastpath', 'flow_offloading');

			if (features.offloading_hw_ipv6) {
				var foHw6 = section.option(form.Flag, 'fastpath_fo_hw_ipv6', _('Hardware offload IPv6'),
					_('When disabled, IPv6 traffic takes the regular forwarding path while IPv4 is hardware offloaded.'));
				foHw6.default = '1';
				foHw6.depends('fastpath_fo_hw', '1');
			}
		}

		if (features.engines.fast_classifier) {
			var fcBr = section.option(form.Flag, 'fastpath_fc_br', _('Bridge acceleration'),
				_('Also offload traffic between bridged LAN ports.'));
			fcBr.default = '1';
			fcBr.depends('fastpath', 'fast_classifier');

			var fcIpv6 = section.option(form.Flag, 'fastpath_fc_ipv6', _('IPv6 acceleration'),
				_('Accelerate IPv6 traffic as well.'));
			fcIpv6.default = '1';
			fcIpv6.depends('fastpath', 'fast_classifier');
		}

		if (features.engines.mediatek_hnat) {
			var mhEth = section.option(form.Flag, 'fastpath_mh_eth_hnat', _('Ethernet HNAT'),
				_('Offload Ethernet forwarding through the MediaTek HNAT engine.'));
			mhEth.default = '1';
			mhEth.depends('fastpath', 'mediatek_hnat');

			var mh6 = section.option(form.Flag, 'fastpath_mh_eth_hnat_v6', _('IPv6 HNAT'),
				_('Offload IPv6 traffic as well.'));
			mh6.default = '1';
			mh6.depends('fastpath_mh_eth_hnat', '1');
		}

		if (features.wed) {
			var wed = section.option(form.Flag, 'fastpath_mh_eth_hnat_wed', _('Wireless WED offload'),
				_('Enable Wireless Ethernet Dispatch on MediaTek Wi-Fi 6/7 radios.'));
			wed.default = '0';
			wed.depends({ 'fastpath': 'flow_offloading', 'fastpath_fo_hw': '1' });
		}

		if (features.fullcone_nft || features.fullcone_broadcom) {
			var nat = map.section(form.NamedSection, 'config', 'turboacc', _('Full-cone NAT'));
			nat.addremove = false;

			var fullcone = nat.option(form.ListValue, 'fullcone', _('Full-cone NAT mode'),
				_('Full-cone NAT lets peers reach services behind the router without port forwarding.'));
			fullcone.value('0', _('Disabled'));

			if (features.fullcone_nft)
				fullcone.value('1', _('FULLCONENAT (nftables)'));

			if (features.fullcone_broadcom)
				fullcone.value('2', _('Broadcom full-cone NAT1'));

			fullcone.default = '0';
			fullcone.rmempty = false;

			var fc6 = nat.option(form.Flag, 'fullcone6', _('Full-cone NAT for IPv6'),
				_('Most IPv6 deployments do not need full-cone NAT.'));
			fc6.default = '0';
		}

		/* With one algorithm there is nothing to choose, and the status card
		 * already reports the active one. */
		if (features.cca.length > 1) {
			var tcp = map.section(form.NamedSection, 'config', 'turboacc', _('TCP congestion control'));
			tcp.addremove = false;

			var cca = tcp.option(form.ListValue, 'tcpcca', _('Congestion control algorithm'),
				_('Algorithm applied system-wide to new TCP connections.'));
			features.cca.forEach(function(name) {
				cca.value(name, String(name).toUpperCase());
			});
			cca.default = 'cubic';
			cca.rmempty = false;
		}

		var card = this.renderStatusCard(features);

		this.updateStatusCard(card, status);

		return map.render().then(L.bind(function(node) {
			poll.add(L.bind(function() {
				return L.resolveDefault(callStatus(), {}).then(L.bind(function(latest) {
					this.updateStatusCard(card, latest || {});
				}, this));
			}, this), 5);

			/*
			 * The map renders its title and description as the first children of
			 * its root node, so the status card goes right after them to keep the
			 * heading on top of the runtime status.
			 */
			var first = node.querySelector('.cbi-section');

			if (first != null)
				node.insertBefore(card.node, first);
			else
				node.appendChild(card.node);

			/*
			 * The disabled and QCA NSS ECM engines expose no sub-options, leaving
			 * the acceleration section flush against the next one.
			 */
			var frame = node.querySelector('#cbi-turboacc-config-fastpath');
			var accel = frame != null ? frame.closest('.cbi-section') : null;

			if (accel != null) {
				var updateSpacing = function() {
					var widget = option.getUIElement('config');
					var engine = widget != null ? widget.getValue() : null;

					if (Array.isArray(engine))
						engine = engine[0];

					accel.classList.toggle('turboacc-sparse',
						engine == 'disabled' || engine == 'qca_nss_ecm');
				};

				node.addEventListener('widget-change', updateSpacing);
				updateSpacing();
			}

			return E('div', { 'class': 'turboacc-page' }, [ node ]);
		}, this));
	}
});
