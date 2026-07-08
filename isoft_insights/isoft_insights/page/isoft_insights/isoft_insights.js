// Isoft Insights - Sales analytics SPA shell.
// Builds a modern toolbar + tab router and lazy-loads view components that
// render into the content area. Shared state (period, dates, company, currency)
// and helpers (api, money) are exposed on `isoft_insights.app`.

frappe.provide('isoft_insights');
frappe.provide('isoft_insights.views');

isoft_insights.METHOD = 'isoft_insights.isoft_insights.utils.';

isoft_insights.THEMES = {
	Blue:   { p: '#2563eb', d: '#1e40af', a: '#3b82f6' },
	Green:  { p: '#059669', d: '#047857', a: '#10b981' },
	Purple: { p: '#7c3aed', d: '#5b21b6', a: '#8b5cf6' },
	Orange: { p: '#ea580c', d: '#c2410c', a: '#f97316' },
	Slate:  { p: '#475569', d: '#334155', a: '#64748b' },
	Dark:   { p: '#0f172a', d: '#020617', a: '#334155' }
};

// period: whether the global period/date filter applies to this view.
isoft_insights.VIEWS = [
	{ key: 'overview',    label: 'Overview',    icon: 'fa-tachometer',  file: 'overview',    period: true },
	{ key: 'customers',   label: 'Customers',   icon: 'fa-users',       file: 'customers',   period: true },
	{ key: 'items',       label: 'Products',    icon: 'fa-cube',        file: 'items',       period: true },
	{ key: 'matrix',      label: 'Matrix',      icon: 'fa-th',          file: 'matrix',      period: false },
	{ key: 'salesteam',   label: 'Sales Team',  icon: 'fa-user-circle', file: 'salesteam',   period: true },
	{ key: 'receivables', label: 'Receivables', icon: 'fa-credit-card', file: 'receivables', period: false },
	{ key: 'balancesheet', label: 'Lucros e Perdas', icon: 'fa-file-text-o', file: 'balancesheet', period: false },
	{ key: 'balanco',     label: 'Balanço',     icon: 'fa-balance-scale', file: 'balanco',    period: false },
	{ key: 'settings',    label: 'Settings',    icon: 'fa-cog',         file: 'settings',    period: false }
];

// Navbar groups: each group is a dropdown of views. Single-view groups act as a
// plain button. `key` must be unique; `views` reference isoft_insights.VIEWS keys.
isoft_insights.GROUPS = [
	{ key: 'sales',      label: 'Sales',      icon: 'fa-line-chart', views: ['overview', 'customers', 'items', 'matrix', 'salesteam'] },
	{ key: 'accounting', label: 'Accounting', icon: 'fa-book',       views: ['balancesheet', 'balanco', 'receivables'] },
	{ key: 'settings',   label: 'Settings',   icon: 'fa-cog',        views: ['settings'] }
];

// Hide the Frappe desk chrome (top navbar + page head) while on this page, like Invenza,
// so it looks like a standalone app. Restored automatically when navigating away.
isoft_insights.apply_chrome = function () {
	const route = (frappe.get_route_str && frappe.get_route_str()) || '';
	const standalone = route.indexOf('isoft-insights') !== -1;
	const $chrome = $('header.navbar, .navbar.sticky-top, .navbar.navbar-default.navbar-fixed-top, .navbar-expand-lg, .page-head');
	if (standalone) {
		$chrome.hide();
		$('.layout-main-section-wrapper').css('margin-top', '0');
		$('.page-container').css('padding-top', '0');
	} else {
		$chrome.show();
		$('.layout-main-section-wrapper').css('margin-top', '');
		$('.page-container').css('padding-top', '');
	}
};

frappe.pages['isoft-insights'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Isoft Insights',
		single_column: true
	});
	isoft_insights.app = new isoft_insights.App(wrapper, page);

	isoft_insights.apply_chrome();
	[100, 400, 900].forEach((t) => setTimeout(isoft_insights.apply_chrome, t));
	if (!isoft_insights._chrome_bound) {
		isoft_insights._chrome_bound = true;
		$(window).on('hashchange', isoft_insights.apply_chrome);
	}
};

frappe.pages['isoft-insights'].on_page_show = function () {
	isoft_insights.apply_chrome();
	// Keep data fresh when navigating back to the page
	if (isoft_insights.app && isoft_insights.app.ready) {
		isoft_insights.app.reload();
	}
};

frappe.pages['isoft-insights'].on_page_hide = function () {
	// Restore the chrome for the rest of the desk
	$('header.navbar, .navbar.sticky-top, .navbar.navbar-default.navbar-fixed-top, .navbar-expand-lg, .page-head').show();
	$('.layout-main-section-wrapper').css('margin-top', '');
	$('.page-container').css('padding-top', '');
};

isoft_insights.App = class App {
	constructor(wrapper, page) {
		this.wrapper = wrapper;
		this.page = page;
		this.ready = false;
		// Default to the wide layout (Frappe caps normal pages at ~1290px).
		$(wrapper).find('.page-body').addClass('full-width');
		this.state = {
			settings: {},
			period: 'This Year',
			from_date: null,
			to_date: null,
			company: null,
			currency: 'USD',
			active_view: 'overview'
		};
		this.inject_styles();
		this.build_shell();
		this.load_settings();
	}

	// ---- shared helpers used by view components ----
	api(method, args) {
		return new Promise((resolve, reject) => {
			frappe.call({
				method: isoft_insights.METHOD + method,
				args: args || {},
				callback: (r) => resolve(r.message),
				error: (e) => reject(e)
			});
		});
	}

	filters() {
		return {
			period: this.state.period,
			from_date: this.state.period === 'Custom' ? this.state.from_date : null,
			to_date: this.state.period === 'Custom' ? this.state.to_date : null,
			company: this.state.company || null
		};
	}

	money(value) {
		try {
			return format_currency(flt(value), this.state.currency);
		} catch (e) {
			return (flt(value)).toFixed(2);
		}
	}

	number(value) {
		return frappe.utils.format_number ? frappe.utils.format_number(flt(value)) : flt(value).toLocaleString();
	}

	$content() {
		return this.page.main.find('#ii-content');
	}

	// ---- bootstrap ----
	load_settings() {
		this.api('get_insights_settings').then((s) => {
			this.state.settings = s || {};
			this.state.period = s.default_period || 'This Year';
			this.state.company = s.default_company || null;
			this.state.currency = s.default_currency || 'USD';
			// Accent is fixed; light/dark follows the Frappe desk theme via CSS.
			this.apply_theme('Blue');

			if (!s.can_access) {
				this.show_lock();
				return;
			}

			this.populate_period();
			this.populate_company(s);
			this.ready = true;
			this.set_view('overview');
		}).catch(() => {
			this.show_lock('Unable to load Isoft Insights settings.');
		});
	}

	apply_theme(name) {
		const t = isoft_insights.THEMES[name] || isoft_insights.THEMES.Blue;
		const root = this.page.main.find('.ii-root')[0];
		if (root) {
			root.style.setProperty('--ii-primary', t.p);
			root.style.setProperty('--ii-primary-dark', t.d);
			root.style.setProperty('--ii-accent', t.a);
		}
	}

	// ---- shell ----
	build_shell() {
		const viewById = (k) => isoft_insights.VIEWS.find((v) => v.key === k);
		const tabs = isoft_insights.GROUPS.map((g) => {
			const views = (g.views || []).map(viewById).filter(Boolean);
			const single = views.length === 1;
			const menu = views.map((v) => `
				<button class="ii-menu-item" data-view="${v.key}">
					<i class="fa ${v.icon}"></i> ${v.label}
				</button>`).join('');
			return `
				<div class="ii-group" data-group="${g.key}">
					<button class="ii-tab ii-group-btn" ${single ? `data-view="${views[0].key}"` : ''}>
						<i class="fa ${g.icon}"></i> ${g.label}
						${single ? '' : '<i class="fa fa-angle-down ii-caret-down"></i>'}
					</button>
					${single ? '' : `<div class="ii-group-menu">${menu}</div>`}
				</div>`;
		}).join('');

		this.page.main.html(`
			<div class="ii-root">
				<div class="ii-bar">
					<div class="ii-brand">
						<span class="ii-brand-logo"><i class="fa fa-line-chart"></i></span>
						<span class="ii-brand-meta">
							<span class="ii-brand-name">Isoft Insights</span>
							<span class="ii-brand-tag">Sales Analytics</span>
						</span>
					</div>
					<div class="ii-tabs">${tabs}</div>
					<div class="ii-filters">
						<select class="form-control ii-input" id="ii-period">
							<option>This Month</option>
							<option>This Quarter</option>
							<option>This Year</option>
							<option>Last 12 Months</option>
							<option>All Time</option>
							<option value="Custom">Custom Range</option>
						</select>
						<input type="date" class="form-control ii-input ii-custom-date" id="ii-from" style="display:none;">
						<input type="date" class="form-control ii-input ii-custom-date" id="ii-to" style="display:none;">
						<select class="form-control ii-input" id="ii-company"></select>
						<button class="btn btn-default ii-refresh" id="ii-truefs" title="Fullscreen (hide browser tabs)">
							<i class="fa fa-arrows-alt"></i>
						</button>
						<button class="btn btn-default ii-refresh" id="ii-refresh" title="Refresh">
							<i class="fa fa-refresh"></i>
						</button>
					</div>
				</div>

				<div id="ii-content"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>

				<div class="ii-lock" id="ii-lock" style="display:none;">
					<div class="ii-lock-box">
						<i class="fa fa-lock"></i>
						<h3>Access restricted</h3>
						<p id="ii-lock-msg">You don't have permission to view Isoft Insights. Ask an administrator to grant access in <b>Isoft Insights Settings</b>.</p>
					</div>
				</div>
			</div>
		`);

		const me = this;

		this.page.main.find('#ii-period').on('change', function () {
			me.state.period = $(this).val();
			const custom = me.state.period === 'Custom';
			me.page.main.find('.ii-custom-date').toggle(custom);
			if (!custom) me.reload();
			else me.maybe_reload_custom();
		});

		this.page.main.find('#ii-from, #ii-to').on('change', function () {
			me.state.from_date = me.page.main.find('#ii-from').val();
			me.state.to_date = me.page.main.find('#ii-to').val();
			me.maybe_reload_custom();
		});

		this.page.main.find('#ii-company').on('change', function () {
			me.state.company = $(this).val() || null;
			me.reload();
		});

		this.page.main.find('#ii-refresh').on('click', () => me.reload());

		this.page.main.find('#ii-truefs').on('click', () => me.toggle_browser_fullscreen());
		$(document).on(
			'fullscreenchange.iinsights webkitfullscreenchange.iinsights mozfullscreenchange.iinsights MSFullscreenChange.iinsights',
			() => me.on_browser_fs_change()
		);

		// Group button: single-view → open directly; multi-view → toggle its menu.
		this.page.main.find('.ii-group-btn').on('click', function (e) {
			e.stopPropagation();
			const $group = $(this).closest('.ii-group');
			const direct = $(this).data('view');
			if (direct) {
				me.close_menus();
				me.set_view(direct);
				return;
			}
			const wasOpen = $group.hasClass('open');
			me.close_menus();
			$group.toggleClass('open', !wasOpen);
		});

		// Menu item → open that view.
		this.page.main.find('.ii-menu-item').on('click', function (e) {
			e.stopPropagation();
			me.close_menus();
			me.set_view($(this).data('view'));
		});

		// Click anywhere else closes any open dropdown.
		if (!isoft_insights._menu_bound) {
			isoft_insights._menu_bound = true;
			$(document).on('click.iimenu', () => {
				if (isoft_insights.app) isoft_insights.app.close_menus();
			});
		}
	}

	close_menus() {
		this.page.main.find('.ii-group').removeClass('open');
	}

	set_maximized(active) {
		const $root = this.page.main.find('.ii-root');
		$root.toggleClass('ii-maximized', active);
		$('body').toggleClass('ii-maximized-lock', active);
		this.page.main.find('#ii-fullscreen i')
			.toggleClass('fa-expand', !active)
			.toggleClass('fa-compress', active);
		setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
	}

	is_browser_fs() {
		return !!(document.fullscreenElement || document.webkitFullscreenElement ||
			document.mozFullScreenElement || document.msFullscreenElement);
	}

	toggle_browser_fullscreen() {
		// True browser fullscreen (like Invenza) - hides the browser tabs/chrome.
		const el = document.documentElement;
		if (!this.is_browser_fs()) {
			const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
			if (req) req.call(el);
		} else {
			const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
			if (exit) exit.call(document);
		}
	}

	on_browser_fs_change() {
		const active = this.is_browser_fs();
		this.page.main.find('#ii-truefs i')
			.toggleClass('fa-arrows-alt', !active)
			.toggleClass('fa-compress', active);
		// Auto-maximize the dashboard while in browser fullscreen so it fills the screen,
		// and restore the prior state on exit (only undo what we auto-applied).
		if (active) {
			if (!this.page.main.find('.ii-root').hasClass('ii-maximized')) {
				this._fs_auto_max = true;
				this.set_maximized(true);
			}
		} else if (this._fs_auto_max) {
			this._fs_auto_max = false;
			this.set_maximized(false);
		} else {
			setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
		}
	}

	maybe_reload_custom() {
		if (this.state.period === 'Custom' && this.state.from_date && this.state.to_date) {
			this.reload();
		}
	}

	populate_period() {
		this.page.main.find('#ii-period').val(this.state.period);
	}

	populate_company(s) {
		const $sel = this.page.main.find('#ii-company');
		$sel.html('<option value="">All Companies</option>');
		this.api('get_companies').then((companies) => {
			(companies || []).forEach((c) => {
				$sel.append(`<option value="${frappe.utils.escape_html(c)}">${frappe.utils.escape_html(c)}</option>`);
			});
			if (this.state.company) $sel.val(this.state.company);
		});
	}

	show_lock(msg) {
		this.page.main.find('#ii-content').hide();
		this.page.main.find('.ii-tabs, .ii-filters').css('visibility', 'hidden');
		if (msg) this.page.main.find('#ii-lock-msg').text(msg);
		this.page.main.find('#ii-lock').show();
	}

	// ---- routing ----
	set_view(key) {
		const view = isoft_insights.VIEWS.find((v) => v.key === key);
		if (!view) return;
		this.state.active_view = key;

		// Highlight the group that owns this view + the active menu item.
		this.page.main.find('.ii-group-btn').removeClass('active');
		this.page.main.find('.ii-menu-item').removeClass('active');
		const group = isoft_insights.GROUPS.find((g) => (g.views || []).indexOf(key) !== -1);
		if (group) {
			const $g = this.page.main.find(`.ii-group[data-group="${group.key}"]`);
			$g.find('.ii-group-btn').addClass('active');
			$g.find(`.ii-menu-item[data-view="${key}"]`).addClass('active');
		}

		// Settings has no global filters; views with their own time controls
		// (matrix, receivables) hide the global period selector but keep company.
		this.page.main.find('.ii-filters').css('display', key === 'settings' ? 'none' : '');
		const usesPeriod = !!view.period;
		this.page.main.find('#ii-period').toggle(usesPeriod);
		this.page.main.find('.ii-custom-date').toggle(usesPeriod && this.state.period === 'Custom');

		const $c = this.$content();
		$c.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');

		const url = `/assets/isoft_insights/js/components/${view.file}.js`;
		frappe.require(url, () => {
			const fn = isoft_insights.views[key];
			if (typeof fn !== 'function') {
				$c.html('<div class="ii-empty">View not available.</div>');
				return;
			}
			try {
				fn(this.ctx());
			} catch (e) {
				console.error('Isoft Insights view error', e);
				$c.html('<div class="ii-empty">Something went wrong rendering this view.</div>');
			}
		});
	}

	reload() {
		if (this.ready) this.set_view(this.state.active_view);
	}

	ctx() {
		return {
			app: this,
			state: this.state,
			$content: this.$content(),
			filters: this.filters(),
			api: this.api.bind(this),
			money: this.money.bind(this),
			number: this.number.bind(this)
		};
	}

	// ---- styles ----
	inject_styles() {
		if (document.getElementById('isoft-insights-styles')) return;
		const css = `
		<style id="isoft-insights-styles">
		.ii-root {
			--ii-primary: #2563eb; --ii-primary-dark: #1e40af; --ii-accent: #3b82f6;
			--ii-bg: #f6f8fb; --ii-card: #ffffff; --ii-border: #e6eaf0; --ii-text: #1f2937; --ii-muted: #6b7280;
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			color: var(--ii-text); padding-bottom: 40px;
		}
		/* Modern sticky top navbar */
		.ii-bar {
			display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
			position: sticky; top: 0; z-index: 30; margin-top: 10px;
			background: var(--ii-card); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
			border: 1px solid var(--ii-border); border-radius: 14px;
			padding: 9px 14px; margin-bottom: 18px;
			box-shadow: 0 6px 22px rgba(17, 24, 39, 0.07);
		}
		.ii-brand { display: flex; align-items: center; gap: 10px; padding-right: 14px; border-right: 1px solid var(--ii-border); }
		.ii-brand-logo {
			width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
			color: #fff; font-size: 16px; background: linear-gradient(135deg, var(--ii-primary), var(--ii-accent));
			box-shadow: 0 4px 11px rgba(37, 99, 235, 0.38);
		}
		.ii-brand-meta { display: flex; flex-direction: column; line-height: 1.15; }
		.ii-brand-name { font-weight: 800; font-size: 14px; letter-spacing: .2px; color: var(--ii-text); white-space: nowrap; }
		.ii-brand-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--ii-muted); }
		.ii-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; }
		.ii-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

		/* Maximize mode: CSS overlay that keeps theme vars in scope and fills the viewport */
		.ii-root.ii-maximized {
			position: fixed; inset: 0; z-index: 1050; margin: 0; max-width: none;
			background: var(--ii-bg); overflow: auto; padding: 18px 26px;
		}
		body.ii-maximized-lock { overflow: hidden; }
		@media (max-width: 760px) { .ii-brand-meta { display: none; } }
		.ii-input { width: auto !important; min-width: 120px; border: 1px solid var(--ii-border) !important; border-radius: 9px !important; height: 32px; }
		.ii-refresh { border: 1px solid var(--ii-border) !important; border-radius: 9px !important; height: 32px; }
		.ii-tab {
			border: 1px solid var(--ii-border); background: var(--ii-card); color: var(--ii-muted);
			border-radius: 10px; padding: 7px 13px; font-weight: 600; font-size: 13px; cursor: pointer;
			transition: all .2s ease;
		}
		.ii-tab i { margin-right: 6px; }
		.ii-tab:hover { color: var(--ii-primary); border-color: var(--ii-accent); transform: translateY(-1px); }
		.ii-tab.active { background: var(--ii-primary); color: #fff; border-color: var(--ii-primary); box-shadow: 0 6px 16px rgba(37,99,235,0.3); }

		/* Grouped navbar dropdowns */
		.ii-group { position: relative; }
		.ii-caret-down { margin-left: 6px !important; margin-right: 0 !important; font-size: 11px; opacity: .8; transition: transform .2s ease; }
		.ii-group.open .ii-caret-down { transform: rotate(180deg); }
		.ii-group.open .ii-group-btn { border-color: var(--ii-accent); color: var(--ii-primary); }
		.ii-group.open .ii-group-btn.active { color: #fff; }
		.ii-group-menu {
			position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; min-width: 210px;
			background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 12px;
			box-shadow: 0 14px 34px rgba(17,24,39,0.16); padding: 6px; display: none;
			animation: ii-menu-in .14s ease;
		}
		.ii-group.open .ii-group-menu { display: block; }
		@keyframes ii-menu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
		.ii-menu-item {
			display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
			border: none; background: transparent; color: var(--ii-text); cursor: pointer;
			border-radius: 8px; padding: 9px 11px; font-weight: 600; font-size: 13px; transition: background .12s ease;
		}
		.ii-menu-item i { width: 16px; text-align: center; color: var(--ii-muted); }
		.ii-menu-item:hover { background: var(--ii-bg); }
		.ii-menu-item.active { background: var(--ii-primary); color: #fff; }
		.ii-menu-item.active i { color: #fff; }
		[data-theme="dark"] .ii-group-menu { box-shadow: 0 14px 34px rgba(0,0,0,0.5); }

		/* Replace the browser's dark default focus outline on navbar controls with a soft themed one */
		.ii-bar .ii-input:focus, .ii-bar .ii-input:focus-visible {
			outline: none !important;
			border-color: var(--ii-accent) !important;
			box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15) !important;
		}
		.ii-tab:focus, .ii-group-btn:focus, .ii-refresh:focus, .ii-menu-item:focus,
		.ii-tab:focus-visible, .ii-group-btn:focus-visible, .ii-refresh:focus-visible, .ii-menu-item:focus-visible {
			outline: none !important;
		}
		.ii-tab:focus:not(.active), .ii-group-btn:focus:not(.active), .ii-refresh:focus {
			box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15) !important;
			border-color: var(--ii-accent) !important;
		}

		.ii-rowfilters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
		.ii-rowfilters label { font-size: 12px; color: var(--ii-muted); font-weight: 600; margin: 0 2px 0 6px; }
		.ii-rowfilters .ii-input { min-width: 110px; background: var(--ii-card); }
		.ii-search { min-width: 200px !important; }

		.ii-matrix-wrap { overflow: auto; max-height: 70vh; border: 1px solid var(--ii-border); border-radius: 12px; }
		.ii-matrix { border-collapse: collapse; font-size: 12.5px; width: 100%; min-width: 620px; }
		.ii-matrix th, .ii-matrix td { padding: 9px 12px; white-space: nowrap; }
		.ii-matrix thead th { position: sticky; top: 0; background: var(--ii-card); color: var(--ii-muted); text-transform: uppercase; font-size: 11px; letter-spacing: .4px; border-bottom: 2px solid var(--ii-border); text-align: right; z-index: 2; }
		.ii-matrix .ii-sticky-col { position: sticky; left: 0; background: var(--ii-card); text-align: left; z-index: 1; border-right: 1px solid var(--ii-border); }
		.ii-matrix thead th.ii-sticky-col { z-index: 4; }
		.ii-matrix td { text-align: right; border-bottom: 1px solid var(--ii-border); font-variant-numeric: tabular-nums; }
		.ii-matrix tbody tr:hover td { background: var(--ii-bg); }
		.ii-matrix tbody tr:hover td.ii-sticky-col { background: #eef2ff; }
		.ii-matrix .ii-total-col { font-weight: 700; }
		.ii-matrix tfoot td { font-weight: 700; border-top: 2px solid var(--ii-border); background: var(--ii-card); position: sticky; bottom: 0; }
		.ii-zero { color: #cbd5e1; }

		.ii-aging-badge { display:inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; }
		.ii-age-current { background:#dcfce7; color:#166534; }
		.ii-age-30 { background:#fef9c3; color:#854d0e; }
		.ii-age-60 { background:#ffedd5; color:#9a3412; }
		.ii-age-90 { background:#fee2e2; color:#991b1b; }
		.ii-age-90p { background:#fecaca; color:#7f1d1d; }
		.ii-totrow td { font-weight: 700; background: var(--ii-bg); }
		.ii-filterrow td { padding: 4px 6px !important; border-bottom: 1px solid var(--ii-border); background: var(--ii-bg); }
		.ii-colf { width: 100% !important; min-width: 56px; height: 28px !important; font-size: 12px !important; padding: 2px 8px !important;
			border: 1px solid var(--ii-border) !important; border-radius: 7px !important; background: var(--ii-card); color: var(--ii-text); }
		.ii-colf::placeholder { color: var(--ii-muted); opacity: .7; }

		.ii-cust-row { cursor: pointer; }
		.ii-cust-row .ii-caret { transition: transform .2s; color: var(--ii-muted); margin-right: 7px; font-size: 11px; }
		.ii-cust-row.open .ii-caret { transform: rotate(90deg); color: var(--ii-primary); }
		.ii-cust-row.open > td { background: #eef2ff; }
		.ii-detail-row > td { background: var(--ii-bg); padding: 4px 12px 14px !important; }
		.ii-subtable { width: 100%; border-collapse: collapse; font-size: 12.5px; background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 8px; overflow: hidden; }
		.ii-subtable th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; color: var(--ii-muted); padding: 8px 10px; border-bottom: 1px solid var(--ii-border); }
		.ii-subtable td { padding: 8px 10px; border-bottom: 1px solid var(--ii-border); }
		.ii-subtable tr:last-child td { border-bottom: none; }
		.ii-overdue { color: #b91c1c; font-weight: 700; }
		.ii-notdue { color: #166534; font-weight: 700; }

		.ii-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 18px; }
		.ii-kpi {
			background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 14px; padding: 18px;
			box-shadow: 0 4px 14px rgba(17,24,39,0.04); transition: all .2s ease; position: relative; overflow: hidden;
		}
		.ii-kpi:hover { transform: translateY(-3px); box-shadow: 0 12px 26px rgba(17,24,39,0.10); }
		.ii-kpi-label { font-size: 12px; color: var(--ii-muted); text-transform: uppercase; letter-spacing: .6px; font-weight: 600; }
		.ii-kpi-value { font-size: 26px; font-weight: 800; margin-top: 6px; }
		.ii-kpi-icon {
			position: absolute; right: 14px; top: 14px; width: 40px; height: 40px; border-radius: 10px;
			display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px;
			background: linear-gradient(135deg, var(--ii-primary), var(--ii-accent));
		}
		.ii-kpi-delta { font-size: 12px; font-weight: 700; margin-top: 8px; }
		.ii-up { color: #059669; } .ii-down { color: #dc2626; } .ii-flat { color: var(--ii-muted); }

		.ii-card {
			background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 14px; padding: 18px;
			box-shadow: 0 4px 14px rgba(17,24,39,0.04); margin-bottom: 18px;
		}
		.ii-card-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
		.ii-card-title .ii-pill { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--ii-muted); background: var(--ii-bg); padding: 3px 9px; border-radius: 20px; }

		.ii-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.ii-table th { text-align: left; color: var(--ii-muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; padding: 10px 12px; border-bottom: 2px solid var(--ii-border); }
		.ii-table td { padding: 11px 12px; border-bottom: 1px solid var(--ii-border); }
		.ii-table tbody tr:hover { background: var(--ii-bg); }
		.ii-table .ii-num { text-align: right; font-variant-numeric: tabular-nums; }
		.ii-rank { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; background: var(--ii-bg); color: var(--ii-primary); font-weight: 700; align-items: center; justify-content: center; font-size: 12px; }
		.ii-bar-cell { min-width: 120px; }
		.ii-bar-track { background: var(--ii-bg); border-radius: 6px; height: 8px; overflow: hidden; }
		.ii-bar-fill { height: 8px; border-radius: 6px; background: linear-gradient(90deg, var(--ii-primary), var(--ii-accent)); }

		.ii-loading, .ii-empty { text-align: center; color: var(--ii-muted); padding: 60px 20px; font-size: 14px; }
		.ii-empty i { font-size: 32px; display: block; margin-bottom: 10px; opacity: .5; }

		.ii-lock { display: flex; align-items: center; justify-content: center; padding: 80px 20px; }
		.ii-lock-box { text-align: center; max-width: 420px; }
		.ii-lock-box i { font-size: 44px; color: var(--ii-muted); margin-bottom: 14px; }
		.ii-lock-box h3 { font-weight: 700; }
		.ii-lock-box p { color: var(--ii-muted); }

		.ii-chart-wrap { width: 100%; }
		.ii-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
		.ii-field-label { font-size: 12px; font-weight: 600; color: var(--ii-muted); margin-bottom: 4px; display: block; }
		.ii-role-grid { display: flex; flex-wrap: wrap; gap: 8px; max-height: 230px; overflow-y: auto; padding: 4px; }
		.ii-role-chip { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-weight: 500; font-size: 12.5px;
			border: 1px solid var(--ii-border); border-radius: 20px; padding: 5px 12px; cursor: pointer; transition: all .15s ease; background: var(--ii-card); }
		.ii-role-chip:hover { border-color: var(--ii-accent); }
		.ii-role-chip.on { background: var(--ii-primary); color: #fff; border-color: var(--ii-primary); }
		.ii-role-chip input { margin: 0; }

		@media (max-width: 600px) {
			.ii-header { flex-direction: column; align-items: flex-start; }
			.ii-kpi-value { font-size: 22px; }
		}

		/* --- Dark mode: follow Frappe's [data-theme="dark"] on <html> --- */
		[data-theme="dark"] .ii-root {
			--ii-bg: #1a1d23; --ii-card: #21242c; --ii-border: #32373f;
			--ii-text: #e6e8ec; --ii-muted: #9aa1ac;
		}
		[data-theme="dark"] .ii-zero { color: #4b5563; }
		[data-theme="dark"] .ii-cust-row.open > td,
		[data-theme="dark"] .ii-matrix tbody tr:hover td.ii-sticky-col { background: rgba(59,130,246,0.16); }
		[data-theme="dark"] .ii-kpi:hover { box-shadow: 0 12px 26px rgba(0,0,0,0.45); }
		[data-theme="dark"] .ii-card { box-shadow: 0 4px 14px rgba(0,0,0,0.30); }
		[data-theme="dark"] .ii-bar { background: var(--ii-card); box-shadow: 0 6px 22px rgba(0,0,0,0.45); }
		[data-theme="dark"] .ii-tab { background: var(--ii-card); }
		</style>`;
		$('head').append(css);
	}
};

// --------------------------------------------------------------------------- //
// Shared: custom settings modal for the two Angola reports
// --------------------------------------------------------------------------- //
isoft_insights.REPORT_SETTINGS = {
	pl: {
		title: 'Cálculo de Lucros e Perdas — Contas',
		report: 'pl',
		getter: 'get_angola_pl_settings',
		saver: 'save_angola_pl_settings',
		sections: [
			{ label: 'Proveitos Operacionais', fields: [
				['acc_vendas', 'Vendas'], ['acc_servicos', 'Prestações de serviços'], ['acc_outros_prov_op', 'Outros proveitos operacionais'] ] },
			{ label: 'Custos Operacionais', fields: [
				['acc_variacoes', 'Variações nos produtos acabados e em vias de fabrico'],
				['acc_trabalhos', 'Trabalhos para a própria empresa'],
				['acc_cmvmc', 'Custo das mercadorias vendidas e matérias consumidas'],
				['acc_custos_pessoal', 'Custos com o Pessoal'],
				['acc_amortizacoes', 'Amortizações'],
				['acc_outros_custos_op', 'Outros custos e perdas operacionais'] ] },
			{ label: 'Resultados Financeiros e Não Operacionais', fields: [
				['acc_fin_proveitos', 'Resultados financeiros — Proveitos'],
				['acc_fin_custos', 'Resultados financeiros — Custos'],
				['acc_res_filiais', 'Resultados de filiais e associadas'],
				['acc_naoop_proveitos', 'Não operacionais — Proveitos'],
				['acc_naoop_custos', 'Não operacionais — Custos'] ] },
			{ label: 'Impostos e Extraordinários', fields: [
				['acc_impostos_rendimento', 'Impostos sobre o rendimento'],
				['acc_imposto_rend_extra', 'Imposto sobre o rendimento (extraordinário)'],
				['acc_extra_proveitos', 'Resultados extraordinários — Proveitos'],
				['acc_extra_custos', 'Resultados extraordinários — Custos'] ] }
		]
	},
	bs: {
		title: 'Balanço — Contas',
		report: 'bs',
		getter: 'get_balance_sheet_settings',
		saver: 'save_balance_sheet_settings',
		sections: [
			{ label: 'Activo Não Corrente', fields: [
				['bs_imob_corp', 'Imobilizações corpóreas — Bruto'],
				['bs_imob_corp_amort', 'Imobilizações corpóreas — Amortizações'],
				['bs_imob_incorp', 'Imobilizações incorpóreas — Bruto'],
				['bs_imob_incorp_amort', 'Imobilizações incorpóreas — Amortizações'],
				['bs_investimentos', 'Investimentos em subsidiárias e associadas'],
				['bs_outros_ativos_fin', 'Outros activos financeiros'],
				['bs_outros_ativos_nao_corr', 'Outros activos não correntes'] ] },
			{ label: 'Activo Corrente', fields: [
				['bs_existencias', 'Existências'], ['bs_contas_receber', 'Contas a receber'],
				['bs_disponibilidades', 'Disponibilidades'], ['bs_outros_ativos_corr', 'Outros activos correntes'] ] },
			{ label: 'Capital Próprio', fields: [
				['bs_capital', 'Capital'], ['bs_prest_supl', 'Prestações suplementares'],
				['bs_reservas', 'Reservas'], ['bs_res_transitados', 'Resultados Transitados'] ] },
			{ label: 'Passivo Não Corrente', fields: [
				['bs_emprestimos_mlp', 'Empréstimos de médio e longo prazo'],
				['bs_impostos_diferidos', 'Impostos diferidos'],
				['bs_prov_clientes', 'Provisões para Clientes de Cobrança Duvidosa'],
				['bs_prov_riscos', 'Provisões para outros riscos e encargos'],
				['bs_outros_passivos_nao_corr', 'Outros passivos não correntes'] ] },
			{ label: 'Passivo Corrente', fields: [
				['bs_contas_pagar', 'Contas a pagar'], ['bs_emprestimos_cp', 'Empréstimos de curto prazo'],
				['bs_parte_corr_mlp', 'Parte corrente de empréstimos a m/l prazo'],
				['bs_outros_passivos_corr', 'Outros passivos correntes'] ] }
		]
	}
};

isoft_insights.openReportSettings = function (report, onSaved) {
	const cfg = isoft_insights.REPORT_SETTINGS[report];
	if (!cfg) return;
	const method = (m) => 'isoft_insights.isoft_insights.utils.' + m;

	frappe.call({ method: method(cfg.getter) }).then((r) => {
		const data = r.message || {};
		if (!data.can_manage) {
			frappe.msgprint(__('Only an Accounts / System Manager can edit these settings.'));
			return;
		}

		let dref = null;
		const autofill = () => {
			const company = dref && dref.get_value('default_company');
			if (!company) { frappe.msgprint(__('Set the Company first.')); return; }
			frappe.call({
				method: method('resolve_standard_accounts'),
				args: { report: cfg.report, company: company },
				freeze: true, freeze_message: __('Matching standard accounts…')
			}).then((res) => {
				const out = res.message || {};
				dref.set_values(out.accounts || {});
				let msg = __('Filled {0} accounts.', [Object.keys(out.accounts || {}).length]);
				if ((out.not_found || []).length) msg += ' ' + __('Not found: {0}', [out.not_found.join(', ')]);
				frappe.show_alert({ message: msg, indicator: 'blue' });
			});
		};

		const fields = [
			{ fieldtype: 'Section Break', label: __('General') },
			{ fieldname: 'default_company', fieldtype: 'Link', options: 'Company', label: __('Company'), reqd: 1 },
			{ fieldname: 'default_fiscal_year', fieldtype: 'Link', options: 'Fiscal Year', label: __('Default Fiscal Year') },
			{ fieldtype: 'Column Break' },
			{ fieldname: 'autofill_btn', fieldtype: 'Button', label: __('Auto-fill Standard Accounts'), click: autofill }
		];

		const acctQuery = (d) => () => ({ filters: d.get_value('default_company') ? { company: d.get_value('default_company') } : {} });
		cfg.sections.forEach((sec) => {
			fields.push({ fieldtype: 'Section Break', label: __(sec.label) });
			const half = Math.ceil(sec.fields.length / 2);
			sec.fields.forEach(([fn, label], i) => {
				if (i === half) fields.push({ fieldtype: 'Column Break' });
				fields.push({
					fieldname: fn, label: __(label), fieldtype: 'Link', options: 'Account',
					get_query: () => acctQuery(dref)()
				});
			});
		});

		const d = new frappe.ui.Dialog({
			title: __(cfg.title),
			size: 'large',
			fields: fields,
			primary_action_label: __('Save'),
			primary_action(values) {
				frappe.call({
					method: method(cfg.saver),
					args: { payload: JSON.stringify(values) },
					freeze: true, freeze_message: __('Saving…')
				}).then(() => {
					frappe.show_alert({ message: __('Settings saved'), indicator: 'green' });
					d.hide();
					if (onSaved) onSaved();
				});
			}
		});
		dref = d;
		d.set_values(data);
		d.show();
	});
};

// --------------------------------------------------------------------------- //
// Shared: clean print output for the two Angola reports
// --------------------------------------------------------------------------- //
isoft_insights.printStatement = function (kind, data) {
	if (!data) { frappe.msgprint(__('Nothing to print yet.')); return; }
	const esc = (s) => frappe.utils.escape_html(s == null ? '' : String(s));
	const fmt = (v) => {
		if (v == null || v === '') return '';
		const n = flt(v);
		const parts = Math.abs(n).toFixed(2).split('.');
		parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
		return (n < 0 ? '-' : '') + parts[0] + ',' + parts[1];
	};

	let head, body;
	if (kind === 'bs') {
		head = `<tr>
				<th class="l" rowspan="2">Descrição</th><th class="n" rowspan="2">Notas</th>
				<th class="num" colspan="3">${esc(data.current_label)}</th>
				<th class="num" rowspan="2">${esc(data.previous_label)}<br><span class="sub">Valor líquido</span></th>
			</tr>
			<tr><th class="num sub">Valor bruto</th><th class="num sub">Amortizações</th><th class="num sub">Valor líquido</th></tr>`;
		body = (data.rows || []).map((r) => {
			if (r.is_header) {
				const c = r.kind === 'header' ? 'sec' : 'subsec';
				return `<tr class="${c}"><td colspan="6">${esc(r.label)}</td></tr>`;
			}
			const c = r.strong ? 'grand' : (r.bold ? 'tot' : '');
			return `<tr class="${c}"><td class="l">${esc(r.label)}</td><td class="n">${esc(r.notas)}</td>
				<td class="num">${fmt(r.bruto)}</td><td class="num">${fmt(r.amort)}</td>
				<td class="num">${fmt(r.liquido)}</td><td class="num">${fmt(r.liquido_prev)}</td></tr>`;
		}).join('');
	} else {
		head = `<tr>
				<th class="l">Descrição</th><th class="n">Notas</th>
				<th class="num">${esc(data.current_label)}<br><span class="sub">Valor líquido</span></th>
				<th class="num">${esc(data.previous_label)}<br><span class="sub">Valor líquido</span></th>
			</tr>`;
		body = (data.rows || []).map((r) => {
			if (r.line_type === 'Header') return `<tr class="sec"><td colspan="4">${esc(r.label)}</td></tr>`;
			const c = r.bold ? 'tot' : '';
			return `<tr class="${c}"><td class="l">${esc(r.label)}</td><td class="n">${esc(r.notas)}</td>
				<td class="num">${fmt(r.current)}</td><td class="num">${fmt(r.previous)}</td></tr>`;
		}).join('');
	}

	const now = new Date();
	const stamp = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.title)}</title>
		<style>
			* { box-sizing: border-box; }
			body { font-family: 'Inter', Arial, sans-serif; color: #1f2937; margin: 28px 34px; font-size: 12px; }
			.doc-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1f2937; padding-bottom: 10px; margin-bottom: 4px; }
			.company { font-size: 18px; font-weight: 800; }
			.title { font-size: 14px; font-weight: 700; margin-top: 2px; }
			.meta { text-align: right; font-size: 11px; color: #6b7280; line-height: 1.5; }
			table { width: 100%; border-collapse: collapse; margin-top: 14px; }
			th, td { padding: 5px 8px; }
			thead th { border-bottom: 1.5px solid #1f2937; font-size: 11px; text-align: left; vertical-align: bottom; }
			th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
			th.n, td.n { text-align: center; width: 44px; color: #6b7280; }
			.sub { font-weight: 400; color: #6b7280; font-size: 10px; }
			tbody td { border-bottom: 1px solid #e5e7eb; }
			tr.sec td { font-weight: 800; text-transform: uppercase; letter-spacing: .5px; background: #f3f4f6; border-top: 1.5px solid #1f2937; }
			tr.subsec td { font-weight: 700; background: #f9fafb; }
			tr.tot td { font-weight: 700; background: #f9fafb; }
			tr.grand td { font-weight: 800; border-top: 1.5px solid #1f2937; border-bottom: 1.5px solid #1f2937; }
			.foot { margin-top: 16px; font-size: 10px; color: #9ca3af; text-align: right; }
			@media print { body { margin: 12mm; } @page { size: A4 portrait; } }
		</style></head>
		<body>
			<div class="doc-head">
				<div><div class="company">${esc(data.company)}</div><div class="title">${esc(data.title)}</div></div>
				<div class="meta">Moeda: <b>${esc(data.currency)}</b><br>Exercício: <b>${esc(data.fiscal_year)}</b><br>Emitido: ${esc(stamp)}</div>
			</div>
			<table><thead>${head}</thead><tbody>${body}</tbody></table>
			<div class="foot">Isoft Insights · ${esc(data.title)}</div>
		</body></html>`;

	const w = window.open('', '_blank');
	if (!w) { frappe.msgprint(__('Please allow pop-ups to print.')); return; }
	w.document.open();
	w.document.write(html);
	w.document.close();
	w.focus();
	setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
};
