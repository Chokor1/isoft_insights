// Isoft Insights - Sales analytics SPA shell.
// Invenza-style shell: a collapsible left sidebar (views, fullscreen, collapse,
// company) and a slim sticky header (view title + period filter). View
// components are lazy-loaded and render into #ii-content. Shared state (period,
// dates, company, currency) and helpers (api, money) are exposed on
// `isoft_insights.app`.

frappe.provide('isoft_insights');
frappe.provide('isoft_insights.views');

isoft_insights.METHOD = 'isoft_insights.isoft_insights.utils.';
isoft_insights.ROUTE = 'isoft-insights';

// period: whether the global period/date filter applies to this view.
// tone: meaning-colour of the sidebar icon, same vocabulary as Invenza —
// item (brand), stock (amber), money (green), buy (violet), perf (teal), muted.
isoft_insights.VIEWS = [
	{ key: 'overview',    label: 'Overview',    icon: 'fa-tachometer',  tone: 'perf',  file: 'overview',    period: true },
	{ key: 'salesreport', label: 'Sales Report', icon: 'fa-shopping-cart', tone: 'money', file: 'salesreport', period: false },
	{ key: 'customers',   label: 'Customers',   icon: 'fa-users',       tone: 'item',  file: 'customers',   period: true },
	{ key: 'items',       label: 'Products',    icon: 'fa-cube',        tone: 'stock', file: 'items',       period: true },
	{ key: 'matrix',      label: 'Matrix',      icon: 'fa-th',          tone: 'perf',  file: 'matrix',      period: false },
	{ key: 'salesteam',   label: 'Sales Team',  icon: 'fa-user-circle', tone: 'item',  file: 'salesteam',   period: true },
	{ key: 'receivables', label: 'Receivables', icon: 'fa-credit-card', tone: 'money', file: 'receivables', period: false },
	{ key: 'payables',    label: 'Payables',    icon: 'fa-money',       tone: 'buy',   file: 'payables',    period: false },
	{ key: 'balancesheet', label: 'Demonstração de Resultados', icon: 'fa-file-text-o', tone: 'perf', file: 'balancesheet', period: false },
	{ key: 'balanco',     label: 'Balanço',     icon: 'fa-balance-scale', tone: 'item', file: 'balanco',    period: false },
	{ key: 'balancete',   label: 'Balancete Geral', icon: 'fa-list-ol', tone: 'perf', file: 'balancete', period: false },
	{ key: 'cashflow',    label: 'Fluxos de Caixa', icon: 'fa-exchange', tone: 'money', file: 'cashflow',  period: false },
	{ key: 'settings',    label: 'Settings',    icon: 'fa-cog',         tone: 'muted', file: 'settings',    period: false }
];

// Sidebar sections. A multi-view group gets a heading; a single-view group is
// a plain link under a separator. `views` reference isoft_insights.VIEWS keys.
isoft_insights.GROUPS = [
	{ key: 'sales',      label: 'Sales',      icon: 'fa-line-chart', tone: 'money', views: ['overview', 'salesreport', 'customers', 'items', 'matrix', 'salesteam'] },
	{ key: 'accounting', label: 'Accounting', icon: 'fa-book',       tone: 'item',  views: ['balancesheet', 'balanco', 'balancete', 'cashflow', 'receivables', 'payables'] },
	{ key: 'settings',   label: 'Settings',   icon: 'fa-cog',        tone: 'muted', views: ['settings'] }
];

// Hide the desk chrome (navbar + page head) only while this route is open.
// It is a body class, not .hide(): the rules live in the shell stylesheet,
// which stays in the DOM after navigating away, so they must be scoped or the
// navbar would vanish from every other desk page.
isoft_insights.apply_chrome = function () {
	const route = (frappe.get_route_str && frappe.get_route_str()) || '';
	$('body').toggleClass('ii-page', route.indexOf(isoft_insights.ROUTE) !== -1);
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
	// Frappe v13 never calls on_page_hide and routes with pushState, so
	// hashchange does not fire either; page-change is what the desk container
	// triggers on every route, and it is the only reliable way to hand back the
	// navbar when the user leaves.
	if (!isoft_insights._chrome_bound) {
		isoft_insights._chrome_bound = true;
		$(document).on('page-change', isoft_insights.apply_chrome);
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
	$('body').removeClass('ii-page');
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
		let collapsed = false;
		try { collapsed = localStorage.getItem('ii_sidebar_collapsed') === '1'; } catch (e) { /* storage blocked */ }
		this.apply_sidebar_state(collapsed);
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
			// "Hide Price Currency" setting -> plain number, no symbol.
			if (this.state.hide_currency) return format_number(flt(value), null, 2);
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
			this.state.hide_currency = cint(s.hide_price_currency) ? 1 : 0;
			// Colours come from the stylesheet tokens; light/dark follows the desk theme.

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

	// ---- shell ----
	build_shell() {
		const esc = frappe.utils.escape_html;
		const viewById = (k) => isoft_insights.VIEWS.find((v) => v.key === k);
		const link = (v, kid) => `
			<button type="button" class="ii-nav-link${kid ? ' ii-nav-kid' : ''}" data-view="${v.key}" title="${esc(v.label)}">
				<span class="ii-nav-icon"><i class="fa ${v.icon} ii-i-${v.tone || 'muted'}"></i></span>
				<span class="ii-nav-label">${esc(v.label)}</span>
			</button>`;
		// A group is one collapsible item, not six loose links: twelve views listed
		// flat is a wall. In the rail the children open BESIDE the icon instead.
		const nav = isoft_insights.GROUPS.map((g) => {
			const views = (g.views || []).map(viewById).filter(Boolean);
			if (!views.length) return '';
			if (views.length === 1) return '<div class="ii-nav-sep"></div>' + link(views[0]);
			return `
				<div class="ii-nav-group" data-group="${g.key}">
					<button type="button" class="ii-nav-link ii-nav-head" title="${esc(g.label)}">
						<span class="ii-nav-icon"><i class="fa ${g.icon} ii-i-${g.tone || 'muted'}"></i></span>
						<span class="ii-nav-label">${esc(g.label)}</span>
						<i class="fa fa-angle-down ii-nav-caret" aria-hidden="true"></i>
					</button>
					<div class="ii-nav-kids">${views.map((v) => link(v, true)).join('')}</div>
				</div>`;
		}).join('');

		this.page.main.html(`
			<div class="ii-root">
				<aside class="ii-sidebar">
					<div class="ii-brand">
						<button type="button" class="ii-brand-logo" id="ii-home" title="Overview"><i class="fa fa-line-chart"></i></button>
						<span class="ii-brand-meta">
							<span class="ii-brand-name">Isoft Insights</span>
							<span class="ii-brand-tag">Sales &amp; Purchase</span>
						</span>
					</div>

					<nav class="ii-nav">
						${nav}
						<div class="ii-nav-sep"></div>
						<button type="button" class="ii-nav-link" id="ii-truefs" title="Fullscreen (hide browser tabs)">
							<span class="ii-nav-icon"><i class="fa fa-arrows-alt ii-i-muted"></i></span>
							<span class="ii-nav-label">Fullscreen</span>
						</button>
						<button type="button" class="ii-nav-link" id="ii-sb-toggle" title="Collapse sidebar">
							<span class="ii-nav-icon"><i class="fa fa-angle-double-left ii-i-muted"></i></span>
							<span class="ii-nav-label">Collapse</span>
						</button>
					</nav>

					<div class="ii-sb-foot">
						<label class="ii-company-wrap" title="Company">
							<i class="fa fa-building"></i>
							<select class="ii-company-select" id="ii-company"></select>
						</label>
					</div>
				</aside>

				<main class="ii-main">
					<div class="ii-bar">
						<div class="ii-head">
							<div class="ii-head-crumb" id="ii-crumb"></div>
							<div class="ii-head-title" id="ii-title">Isoft Insights</div>
						</div>
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
				</main>
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

		this.page.main.find('.ii-nav-link[data-view]').on('click', function () {
			me.close_flyouts();
			me.set_view($(this).attr('data-view'));
		});

		this.page.main.find('.ii-nav-head').on('click', function (e) {
			e.stopPropagation();
			const $group = $(this).closest('.ii-nav-group');
			if (me.is_rail()) me.open_flyout($group);
			else $group.toggleClass('open');
		});

		// A click anywhere else closes an open rail flyout.
		if (!isoft_insights._flyout_bound) {
			isoft_insights._flyout_bound = true;
			$(document).on('click.iiflyout', () => {
				if (isoft_insights.app) isoft_insights.app.close_flyouts();
			});
		}

		this.page.main.find('#ii-home').on('click', () => {
			if (me.ready) me.set_view('overview');
		});

		this.page.main.find('#ii-sb-toggle').on('click', () => {
			const collapsed = !me.page.main.find('.ii-root').hasClass('ii-sb-collapsed');
			try { localStorage.setItem('ii_sidebar_collapsed', collapsed ? '1' : '0'); } catch (e) { /* storage blocked */ }
			me.apply_sidebar_state(collapsed);
		});

		this.page.main.find('#ii-truefs').on('click', () => me.toggle_browser_fullscreen());
		$(document)
			.off('.iinsights')
			.on(
				'fullscreenchange.iinsights webkitfullscreenchange.iinsights mozfullscreenchange.iinsights MSFullscreenChange.iinsights',
				() => isoft_insights.app && isoft_insights.app.on_browser_fs_change()
			);
	}

	apply_sidebar_state(collapsed) {
		const $m = this.page.main;
		$m.find('.ii-root').toggleClass('ii-sb-collapsed', !!collapsed);
		const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
		const $t = $m.find('#ii-sb-toggle').attr('title', label);
		$t.find('.ii-nav-label').text(collapsed ? 'Expand' : 'Collapse');
		$t.find('i')
			.toggleClass('fa-angle-double-left', !collapsed)
			.toggleClass('fa-angle-double-right', !!collapsed);
		this.close_flyouts();
		// No synthetic resize event, and the width change is instant (see the
		// stylesheet): frappe-charts redraws from its own ResizeObserver, and
		// driving it a second time mid-draw makes it throw removeChild.
	}

	is_rail() {
		return this.page.main.find('.ii-root').hasClass('ii-sb-collapsed') ||
			(window.matchMedia && window.matchMedia('(max-width: 1024px)').matches);
	}

	close_flyouts() {
		this.page.main.find('.ii-nav-group.flyout').removeClass('flyout');
	}

	// In the rail there is no room for a label under a 62px icon, so a group opens
	// as a small menu beside it. Fixed-positioned, so the nav cannot clip it.
	open_flyout($group) {
		const was_open = $group.hasClass('flyout');
		this.close_flyouts();
		if (was_open) return;
		$group.addClass('flyout');
		const $kids = $group.find('.ii-nav-kids');
		const top = $group[0].getBoundingClientRect().top;
		const height = $kids.outerHeight() || 0;
		$kids.css('top', Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 12))) + 'px');
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
		// The shell already fills the viewport, so there is nothing to maximise;
		// just keep the control in step and let charts re-measure.
		const active = this.is_browser_fs();
		const $b = this.page.main.find('#ii-truefs');
		$b.find('i').toggleClass('fa-arrows-alt', !active).toggleClass('fa-compress', active);
		$b.find('.ii-nav-label').text(active ? 'Exit fullscreen' : 'Fullscreen');
		setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
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
		const me = this;
		const esc = frappe.utils.escape_html;
		const $sel = this.page.main.find('#ii-company');
		$sel.html('');
		this.api('get_companies').then((companies) => {
			companies = companies || [];
			companies.forEach((c) => {
				$sel.append(`<option value="${esc(c)}">${esc(c)}</option>`);
			});
			// No "All Companies" option: always keep a specific company selected.
			const had_company = !!me.state.company;
			if (!me.state.company && companies.length) {
				me.state.company = companies[0];
			}
			if (me.state.company) $sel.val(me.state.company);
			// If we had to default the company after the initial view already
			// rendered (settings had no default company), reload so data matches.
			if (!had_company && me.state.company && me.ready) {
				me.reload();
			}
		});
	}

	show_lock(msg) {
		this.page.main.find('#ii-content').hide();
		this.page.main.find('.ii-nav, .ii-filters, .ii-sb-foot').css('visibility', 'hidden');
		if (msg) this.page.main.find('#ii-lock-msg').text(msg);
		this.page.main.find('#ii-lock').show();
	}

	// ---- routing ----
	set_view(key) {
		const view = isoft_insights.VIEWS.find((v) => v.key === key);
		if (!view) return;
		this.state.active_view = key;

		const esc = frappe.utils.escape_html;
		this.page.main.find('.ii-nav-link').removeClass('active active-group');
		this.page.main.find(`.ii-nav-link[data-view="${key}"]`).addClass('active');
		const group = isoft_insights.GROUPS.find((g) => (g.views || []).indexOf(key) !== -1);
		// Open the group that owns the view, so the current screen is never hidden
		// inside a closed group.
		if (group) {
			const $g = this.page.main.find(`.ii-nav-group[data-group="${group.key}"]`).addClass('open');
			$g.children('.ii-nav-head').addClass('active-group');
		}
		this.page.main.find('#ii-crumb').text(group && group.views.length > 1 ? group.label : '');
		this.page.main.find('#ii-title').html(
			`<i class="fa ${view.icon} ii-i-${view.tone || 'muted'}"></i><span>${esc(view.label)}</span>`
		);

		// Settings has no global filters; views with their own time controls
		// (matrix, receivables) hide the global period selector but keep company.
		this.page.main.find('.ii-filters').css('display', key === 'settings' ? 'none' : '');
		const usesPeriod = !!view.period;
		this.page.main.find('#ii-period').toggle(usesPeriod);
		this.page.main.find('.ii-custom-date').toggle(usesPeriod && this.state.period === 'Custom');

		const $c = this.$content();
		$c.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		this.page.main.find('.ii-main').scrollTop(0);

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

		// Icon-rail layout, written once and applied in two places: when the user
		// collapses the sidebar, and below 1024px where the rail is forced.
		const rail = (s) => `
		${s} .ii-brand { justify-content: center; padding-left: .4rem; padding-right: .4rem; }
		${s} .ii-brand-meta, ${s} .ii-nav-label { display: none; }
		${s} .ii-nav-caret { display: none; }
		/* A group opens beside its icon, not under it: a stack of unlabelled
		   children in a 62px rail says nothing. */
		${s} .ii-nav-group > .ii-nav-kids { display: none; max-height: none; }
		${s} .ii-nav-group.flyout > .ii-nav-kids {
			display: block; position: fixed; left: calc(var(--ii-sb) + 6px); z-index: 1030;
			min-width: 214px; padding: 6px; border-radius: 10px;
			background: var(--ii-card); border: 1px solid var(--ii-border); box-shadow: 0 12px 28px rgba(15,23,42,.14);
		}
		[data-theme="dark"] ${s} .ii-nav-group.flyout > .ii-nav-kids { box-shadow: 0 12px 28px rgba(0,0,0,.5); }
		${s} .ii-nav-group.flyout > .ii-nav-kids .ii-nav-label { display: block; }
		${s} .ii-nav-group.flyout > .ii-nav-kids .ii-nav-link { justify-content: flex-start; gap: .7rem; padding-left: .6rem; padding-right: .8rem; }
		${s} .ii-nav-link, ${s} .ii-company-wrap { justify-content: center; padding-left: .4rem; padding-right: .4rem; gap: 0; }
		${s} .ii-company-wrap > i { width: auto; }
		/* The select stays clickable as an invisible layer over the icon, so the
		   company can still be switched from the rail. */
		${s} .ii-company-select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }`;

		const css = `
		<style id="isoft-insights-styles">
		body.ii-page header.navbar,
		body.ii-page .navbar.navbar-expand,
		body.ii-page .page-head { display: none !important; }
		body.ii-page .layout-main-section-wrapper { margin-top: 0 !important; }
		body.ii-page .page-container { padding-top: 0 !important; }
		body.ii-page .main-section { padding-top: 0 !important; }

		/* ---- Tokens: Invenza's slate palette. Only these two blocks differ between
		   light and dark; dark follows Frappe's [data-theme="dark"] on <html>. ---- */
		.ii-root {
			--ii-sb: 224px;
			--ii-page: #f1f5f9; --ii-side: #ffffff; --ii-card: #ffffff;
			--ii-bg: #f1f5f9; --ii-bg-2: #f8fafc;
			--ii-border: #e2e8f0; --ii-border-2: #cbd5e1;
			--ii-text: #0f172a; --ii-text-2: #334155; --ii-muted: #64748b; --ii-faint: #94a3b8;
			--ii-primary: #2563eb; --ii-primary-dark: #1d4ed8; --ii-accent: #3b82f6; --ii-accent-ink: #2563eb;
			--ii-soft: #eff6ff; --ii-soft-solid: #eff6ff; --ii-ring: rgba(59,130,246,0.28);
			--ii-ok: #15803d; --ii-warn: #b45309; --ii-orange: #c2410c; --ii-bad: #b91c1c;
			--ii-violet: #8b5cf6; --ii-teal: #0f8b8d;
			font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			color: var(--ii-text);
		}
		[data-theme="dark"] .ii-root {
			--ii-page: #0b1220; --ii-side: #131c2e; --ii-card: #1e293b;
			--ii-bg: #263244; --ii-bg-2: #182236;
			--ii-border: #334155; --ii-border-2: #475569;
			--ii-text: #f1f5f9; --ii-text-2: #cbd5e1; --ii-muted: #94a3b8; --ii-faint: #64748b;
			--ii-primary: #3b82f6; --ii-primary-dark: #2563eb; --ii-accent: #60a5fa; --ii-accent-ink: #60a5fa;
			--ii-soft: rgba(96,165,250,0.16); --ii-soft-solid: #293d5a; --ii-ring: rgba(96,165,250,0.35);
			--ii-ok: #4ade80; --ii-warn: #fbbf24; --ii-orange: #fb923c; --ii-bad: #f87171;
			--ii-violet: #a78bfa; --ii-teal: #2dd4bf;
		}
		.ii-root.ii-sb-collapsed { --ii-sb: 62px; }

		.ii-i-item  { color: var(--ii-accent) !important; }
		.ii-i-stock { color: var(--ii-warn) !important; }
		.ii-i-money { color: var(--ii-ok) !important; }
		.ii-i-buy   { color: var(--ii-violet) !important; }
		.ii-i-perf  { color: var(--ii-teal) !important; }
		.ii-i-alert { color: var(--ii-bad) !important; }
		.ii-i-muted { color: var(--ii-faint) !important; }

		/* ---- Sidebar ---- */
		.ii-sidebar {
			position: fixed; top: 0; left: 0; bottom: 0; width: var(--ii-sb); z-index: 1020;
			display: flex; flex-direction: column; overflow: hidden;
			background: var(--ii-side); color: var(--ii-text); border-right: 1px solid var(--ii-border);
		}
		.ii-brand {
			display: flex; align-items: center; gap: .6rem; flex-shrink: 0;
			min-height: 58px; padding: .6rem .75rem; border-bottom: 1px solid var(--ii-border);
		}
		.ii-brand-logo {
			width: 34px; height: 34px; flex-shrink: 0; border: 0; border-radius: 9px; cursor: pointer;
			display: flex; align-items: center; justify-content: center;
			background: var(--ii-primary); color: #fff; font-size: 16px;
			transition: filter .2s, transform .2s;
		}
		.ii-brand-logo:hover { filter: brightness(1.08); transform: scale(1.06); }
		.ii-brand-meta { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; white-space: nowrap; }
		.ii-brand-name { font-size: 15px; font-weight: 700; letter-spacing: -.02em; color: var(--ii-text); }
		.ii-brand-tag { font-size: 11px; font-weight: 500; letter-spacing: .03em; color: var(--ii-muted); }

		.ii-nav {
			flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
			padding: .6rem .5rem; display: flex; flex-direction: column; gap: 2px;
		}
		.ii-nav::-webkit-scrollbar { width: 6px; }
		.ii-nav::-webkit-scrollbar-thumb { background: var(--ii-border); border-radius: 3px; }
		.ii-nav-caret { margin-left: auto; font-size: 11px; color: var(--ii-faint); transition: transform .18s; }
		.ii-nav-group.open > .ii-nav-head .ii-nav-caret { transform: rotate(180deg); }
		.ii-nav-head.active-group { color: var(--ii-text); font-weight: 600; }
		/* Collapsible group. A max-height transition, not the 0fr->1fr grid trick:
		   the children are siblings here and that trick needs one wrapper child. */
		.ii-nav-kids { max-height: 0; overflow: hidden; transition: max-height .2s ease; }
		.ii-nav-group.open > .ii-nav-kids { max-height: 420px; }
		.ii-nav-kid { padding-left: 1.7rem; font-size: 12.5px; color: var(--ii-muted); }
		.ii-nav-kid .ii-nav-icon { font-size: 12px; }
		.ii-nav-kid.active { color: var(--ii-accent-ink); }
		.ii-nav-sep { flex-shrink: 0; height: 1px; margin: .45rem .2rem; background: var(--ii-border); }
		.ii-nav-link {
			display: flex; align-items: center; gap: .7rem; width: 100%; flex-shrink: 0;
			padding: .5rem .6rem; border: 0; border-radius: 9px; background: transparent;
			color: var(--ii-text-2); font-size: 13px; font-weight: 500; text-align: left; cursor: pointer;
			transition: background .15s, color .15s;
		}
		.ii-nav-link:hover { background: var(--ii-bg); color: var(--ii-text); }
		.ii-nav-link.active { background: var(--ii-soft); color: var(--ii-accent-ink); font-weight: 600; }
		.ii-nav-icon { width: 20px; flex-shrink: 0; text-align: center; font-size: 14px; }
		.ii-nav-label { min-width: 0; line-height: 1.25; }
		.ii-sidebar :focus { outline: none !important; }
		.ii-sidebar button:focus-visible, .ii-sidebar select:focus-visible { box-shadow: 0 0 0 3px var(--ii-ring) !important; }

		.ii-sb-foot { flex-shrink: 0; padding: .5rem; border-top: 1px solid var(--ii-border); }
		.ii-company-wrap {
			position: relative; display: flex; align-items: center; gap: .5rem; margin: 0;
			padding: .45rem .6rem; border-radius: 9px; cursor: pointer; font-weight: normal;
			background: var(--ii-bg-2); border: 1px solid var(--ii-border); color: var(--ii-text);
		}
		.ii-company-wrap > i { width: 20px; flex-shrink: 0; text-align: center; color: var(--ii-muted); }
		.ii-company-select {
			flex: 1; width: 100%; min-width: 0; border: 0; outline: none; cursor: pointer;
			background: transparent; color: var(--ii-text); font-size: 12.5px; font-weight: 600; text-overflow: ellipsis;
		}
		.ii-company-select option { color: #0f172a; background: #fff; }
		[data-theme="dark"] .ii-company-select option { color: #f1f5f9; background: #0f172a; }
		${rail('.ii-root.ii-sb-collapsed')}

		/* ---- Content area ---- */
		.ii-main {
			position: fixed; top: 0; right: 0; bottom: 0; left: var(--ii-sb);
			overflow: auto; padding: 0 1.25rem 2rem; background: var(--ii-page);
			/* Collapsing is INSTANT. An animated width resizes the chart containers
			   over ~10 frames and frappe-charts redraws on each one, which makes its
			   ResizeObserver remove nodes an earlier draw already replaced
			   (NotFoundError: removeChild). Verified both ways. */
		}
		.ii-bar {
			position: sticky; top: 0; z-index: 30;
			display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
			min-height: 58px; margin: 0 -1.25rem 1rem; padding: .6rem 1.25rem;
			background: var(--ii-side); border-bottom: 1px solid var(--ii-border);
		}
		.ii-head { flex: 1 1 auto; min-width: 0; }
		.ii-head-crumb { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--ii-faint); line-height: 1.3; }
		.ii-head-crumb:empty { display: none; }
		.ii-head-title { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; letter-spacing: -.01em; color: var(--ii-text); line-height: 1.3; }
		.ii-head-title i { font-size: 15px; }
		.ii-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

		.ii-input {
			width: auto !important; min-width: 120px; height: 32px !important; font-size: 13px !important;
			border: 1px solid var(--ii-border-2) !important; border-radius: 6px !important;
			background-color: var(--ii-card) !important; color: var(--ii-text) !important; box-shadow: none !important;
		}
		.ii-refresh {
			height: 32px; min-width: 32px; display: inline-flex; align-items: center; justify-content: center;
			border: 1px solid var(--ii-border-2) !important; border-radius: 6px !important;
			background: var(--ii-card) !important; color: var(--ii-text-2) !important; box-shadow: none !important;
		}
		.ii-refresh:hover { border-color: var(--ii-faint) !important; color: var(--ii-text) !important; }
		.ii-root .ii-input:focus, .ii-root .ii-input:focus-visible, .ii-root .ii-colf:focus {
			outline: none !important; border-color: var(--ii-accent) !important; box-shadow: 0 0 0 3px var(--ii-ring) !important;
		}
		.ii-refresh:focus, .ii-refresh:focus-visible { outline: none !important; box-shadow: 0 0 0 3px var(--ii-ring) !important; }

		.ii-rowfilters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
		.ii-rowfilters label { font-size: 12px; color: var(--ii-muted); font-weight: 600; margin: 0 2px 0 6px; }
		.ii-search { min-width: 200px !important; }

		.ii-matrix-wrap { overflow: auto; max-height: 70vh; border: 1px solid var(--ii-border); border-radius: 8px; }
		.ii-matrix { border-collapse: collapse; font-size: 12.5px; width: 100%; min-width: 620px; }
		.ii-matrix th, .ii-matrix td { padding: 8px 12px; white-space: nowrap; }
		.ii-matrix thead th { position: sticky; top: 0; background: var(--ii-bg-2); color: var(--ii-muted); text-transform: uppercase; font-size: 11px; font-weight: 600; letter-spacing: .04em; border-bottom: 1px solid var(--ii-border); text-align: right; z-index: 2; }
		.ii-matrix .ii-sticky-col { position: sticky; left: 0; background: var(--ii-card); text-align: left; z-index: 1; border-right: 1px solid var(--ii-border); }
		.ii-matrix thead th.ii-sticky-col { z-index: 4; background: var(--ii-bg-2); }
		.ii-matrix td { text-align: right; border-bottom: 1px solid var(--ii-border); font-variant-numeric: tabular-nums; }
		.ii-matrix tbody tr:hover td { background: var(--ii-bg); }
		.ii-matrix tbody tr:hover td.ii-sticky-col { background: var(--ii-soft-solid); }
		.ii-matrix .ii-total-col { font-weight: 700; }
		.ii-matrix tfoot td { font-weight: 700; border-top: 1px solid var(--ii-border-2); background: var(--ii-bg-2); position: sticky; bottom: 0; }
		.ii-zero { color: var(--ii-border-2); }

		.ii-aging-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
		.ii-age-current { background: #dcfce7; color: #166534; }
		.ii-age-30 { background: #fef9c3; color: #854d0e; }
		.ii-age-60 { background: #ffedd5; color: #9a3412; }
		.ii-age-90 { background: #fee2e2; color: #991b1b; }
		.ii-age-90p { background: #fecaca; color: #7f1d1d; }
		[data-theme="dark"] .ii-age-current { background: rgba(74,222,128,0.14); color: #4ade80; }
		[data-theme="dark"] .ii-age-30 { background: rgba(250,204,21,0.14); color: #facc15; }
		[data-theme="dark"] .ii-age-60 { background: rgba(251,146,60,0.15); color: #fb923c; }
		[data-theme="dark"] .ii-age-90 { background: rgba(248,113,113,0.15); color: #f87171; }
		[data-theme="dark"] .ii-age-90p { background: rgba(239,68,68,0.24); color: #fca5a5; }
		.ii-totrow td { font-weight: 700; background: var(--ii-bg-2); border-top: 1px solid var(--ii-border-2); }
		.ii-filterrow td { padding: 4px 6px !important; border-bottom: 1px solid var(--ii-border); background: var(--ii-bg-2); }
		.ii-colf { width: 100% !important; min-width: 56px; height: 28px !important; font-size: 12px !important; padding: 2px 8px !important;
			border: 1px solid var(--ii-border-2) !important; border-radius: 6px !important; background: var(--ii-card) !important; color: var(--ii-text) !important; box-shadow: none !important; }
		.ii-colf::placeholder { color: var(--ii-faint); opacity: 1; }

		.ii-cust-row { cursor: pointer; }
		.ii-cust-row .ii-caret { transition: transform .2s; color: var(--ii-muted); margin-right: 7px; font-size: 11px; }
		.ii-cust-row.open .ii-caret { transform: rotate(90deg); color: var(--ii-accent-ink); }
		.ii-cust-row.open > td { background: var(--ii-soft-solid); }
		.ii-detail-row > td { background: var(--ii-bg-2); padding: 4px 12px 14px !important; }
		.ii-subtable { width: 100%; border-collapse: collapse; font-size: 12.5px; background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 8px; overflow: hidden; }
		.ii-subtable th { text-align: left; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--ii-muted); padding: 8px 10px; border-bottom: 1px solid var(--ii-border); }
		.ii-subtable td { padding: 8px 10px; border-bottom: 1px solid var(--ii-border); }
		.ii-subtable tr:last-child td { border-bottom: none; }
		.ii-overdue { color: var(--ii-bad); font-weight: 700; }
		.ii-notdue { color: var(--ii-ok); font-weight: 700; }

		/* ---- Flat cards ---- */
		.ii-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
		.ii-kpi {
			position: relative; overflow: hidden; padding: 16px 18px;
			background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 10px;
		}
		.ii-kpi-label { font-size: 11.5px; color: var(--ii-muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
		.ii-kpi-value { font-size: 24px; font-weight: 700; letter-spacing: -.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
		.ii-kpi-icon {
			position: absolute; right: 14px; top: 14px; width: 36px; height: 36px; border-radius: 9px;
			display: flex; align-items: center; justify-content: center; font-size: 16px;
			background: var(--ii-soft); color: var(--ii-accent-ink);
		}
		.ii-kpi-delta { display: inline-block; font-size: 12px; font-weight: 600; margin-top: 8px; }
		.ii-up { color: var(--ii-ok); } .ii-down { color: var(--ii-bad); } .ii-flat { color: var(--ii-muted); }

		.ii-card {
			background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 10px;
			padding: 16px 18px; margin-bottom: 16px;
		}
		.ii-card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--ii-text); }
		.ii-card-title > i { color: var(--ii-muted); }
		.ii-card-title .ii-pill { margin-left: auto; font-size: 11px; font-weight: 500; color: var(--ii-muted); background: var(--ii-bg); padding: 3px 9px; border-radius: 999px; }

		.ii-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.ii-table th { text-align: left; color: var(--ii-muted); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; padding: 9px 12px; background: var(--ii-bg-2); border-bottom: 1px solid var(--ii-border); }
		.ii-table td { padding: 10px 12px; border-bottom: 1px solid var(--ii-border); }
		.ii-table tbody tr:hover { background: var(--ii-bg); }
		.ii-table .ii-num { text-align: right; font-variant-numeric: tabular-nums; }
		.ii-rank { display: inline-flex; width: 24px; height: 24px; border-radius: 50%; background: var(--ii-soft); color: var(--ii-accent-ink); font-weight: 600; align-items: center; justify-content: center; font-size: 12px; }
		.ii-bar-cell { min-width: 120px; }
		.ii-bar-track { background: var(--ii-bg); border-radius: 999px; height: 6px; overflow: hidden; }
		.ii-bar-fill { height: 6px; border-radius: 999px; background: var(--ii-primary); }

		.ii-loading, .ii-empty { text-align: center; color: var(--ii-muted); padding: 60px 20px; font-size: 14px; }
		.ii-empty i { font-size: 32px; display: block; margin-bottom: 10px; opacity: .5; }

		.ii-lock { display: flex; align-items: center; justify-content: center; padding: 80px 20px; }
		.ii-lock-box { text-align: center; max-width: 420px; background: var(--ii-card); border: 1px solid var(--ii-border); border-radius: 10px; padding: 28px 32px; }
		.ii-lock-box i { font-size: 40px; color: var(--ii-faint); margin-bottom: 14px; }
		.ii-lock-box h3 { font-weight: 700; color: var(--ii-text); }
		.ii-lock-box p { color: var(--ii-muted); margin-bottom: 0; }

		.ii-chart-wrap { width: 100%; }
		.ii-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
		.ii-field-label { font-size: 12px; font-weight: 600; color: var(--ii-muted); margin-bottom: 4px; display: block; }
		.ii-chk { display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 13px; margin: 0; padding-top: 6px; cursor: pointer; }
		.ii-chk input { margin: 0; }
		.ii-role-grid { display: flex; flex-wrap: wrap; gap: 8px; max-height: 230px; overflow-y: auto; padding: 4px; }
		.ii-role-chip { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-weight: 500; font-size: 12.5px;
			border: 1px solid var(--ii-border-2); border-radius: 999px; padding: 4px 11px; cursor: pointer; transition: all .15s ease; background: var(--ii-card); color: var(--ii-text-2); }
		.ii-role-chip:hover { border-color: var(--ii-accent); }
		.ii-role-chip.on { background: var(--ii-soft); color: var(--ii-accent-ink); border-color: var(--ii-accent); }
		.ii-role-chip input { margin: 0; }

		@media (max-width: 1024px) {
			.ii-root { --ii-sb: 62px; }
			.ii-root #ii-sb-toggle { display: none; }
			${rail('.ii-root')}
		}
		@media (max-width: 640px) {
			.ii-main { padding: 0 .75rem 1.5rem; }
			.ii-bar { margin: 0 -.75rem .75rem; padding: .6rem .75rem; }
			.ii-kpi-value { font-size: 20px; }
		}

		/* ---- Shared financial-statement styles (DR / Balanço / Fluxos de Caixa) ----
		   Defined here in the always-loaded shell so every statement looks identical
		   no matter which one is opened first. Components add only their specifics. */
		.bs-card { padding: 0; overflow: hidden; }
		.bs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
			padding: 16px 18px; border-bottom: 1px solid var(--ii-border); flex-wrap: wrap; }
		.bs-title { font-size: 15px; font-weight: 700; }
		.bs-sub { font-size: 11.5px; color: var(--ii-muted); margin-top: 3px; text-transform: uppercase; letter-spacing: .04em; }
		.bs-badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
		.bs-badge.ok { background: #dcfce7; color: #166534; }
		.bs-badge.bad { background: #fee2e2; color: #991b1b; }
		.bs-warn { margin: 12px 20px 0; padding: 9px 12px; border-radius: 8px; font-size: 12.5px;
			background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
		.bs-warn i { margin-right: 6px; }
		.bs-table-wrap { overflow-x: auto; padding: 8px 4px 12px; }
		.bs-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 560px; }
		.bs-table th { text-align: left; color: var(--ii-text); font-weight: 700; font-size: 12.5px;
			padding: 8px 14px; border-bottom: 1px solid var(--ii-border); }
		.bs-table thead tr:first-child th { border-bottom: none; padding-bottom: 2px; }
		.bs-table tr.bs-subhead th { font-weight: 500; color: var(--ii-muted); font-size: 11.5px; padding-top: 0;
			border-bottom: 2px solid var(--ii-border); }
		.bs-table th.bs-num, .bs-table td.bs-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
		.bs-table td { padding: 9px 14px; border-bottom: 1px solid var(--ii-border); }
		.bs-table td.bs-notas, .bs-table th.bs-notas { width: 64px; color: var(--ii-muted); font-size: 12px; }
		.bs-table td.bs-label { color: var(--ii-text); }
		.bs-table td.bs-prev { color: var(--ii-muted); }
		.bs-table tr.bs-total td { font-weight: 800; background: var(--ii-bg); border-top: 1px solid var(--ii-border); }
		.bs-table tr.bs-header td { font-weight: 700; text-transform: uppercase; font-size: 11.5px; letter-spacing: .5px;
			color: var(--ii-accent-ink); background: var(--ii-bg); padding-top: 12px; }
		.bs-table td.bs-neg { color: #dc2626; }
		.bs-table tbody tr:hover td { background: var(--ii-bg); }
		.bs-sublabel { font-weight: 500; color: var(--ii-muted); font-size: 10px; }
		/* variation cell */
		.v-cell { font-weight: 700; }
		.v-cell .v-arrow { font-size: 10px; margin-right: 1px; }
		.v-cell .v-pct-main { font-weight: 700; font-size: 13.5px; }
		.v-cell .v-amt { font-weight: 500; font-size: 11px; opacity: .75; margin-left: 5px; }
		.v-good { color: #059669; } .v-bad { color: #dc2626; } .v-flat { color: var(--ii-muted); }
		/* drill-down */
		.bs-table tr.bs-dr { cursor: pointer; }
		.bs-table tr.bs-dr:hover td { background: var(--ii-bg); }
		.bs-caret { color: var(--ii-muted); font-size: 11px; margin-right: 7px; display: inline-block; transition: transform .15s ease; }
		.bs-caret.down { transform: rotate(90deg); color: var(--ii-primary); }
		.bs-caret-space { display: inline-block; width: 11px; margin-right: 7px; }
		.bs-table tr.bs-drill-child td { background: rgba(37,99,235,0.035); font-size: 12.5px; }
		.bs-table tr.bs-drill-child td.bs-label { color: var(--ii-text); }
		[data-theme="dark"] .bs-table tr.bs-drill-child td { background: rgba(59,130,246,0.07); }
		@media print {
			.ii-sidebar, .ii-bar, .ii-rowfilters { display: none !important; }
			.ii-main { position: static !important; overflow: visible !important; padding: 0 !important; }
			.bs-card { box-shadow: none; border: none; }
		}
		</style>`;
		$('head').append(css);
	}
};

// --------------------------------------------------------------------------- //
// Shared: custom settings modal for the two Angola reports
// --------------------------------------------------------------------------- //
isoft_insights.REPORT_SETTINGS = {
	pl: {
		title: 'Demonstração de Resultados — Contas',
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
	cf: {
		title: 'Fluxos de Caixa — Contas',
		report: 'cf',
		getter: 'get_cash_flow_settings',
		saver: 'save_cash_flow_settings',
		sections: [
			{ label: 'Atividades Operacionais (método directo)', fields: [
				['cf_receb_clientes', 'Recebimentos de clientes'],
				['cf_pag_fornecedores', 'Pagamentos a fornecedores'],
				['cf_pag_pessoal', 'Pagamentos ao pessoal'],
				['cf_imposto_rendimento', 'Imposto sobre o rendimento (pag./receb.)'],
				['cf_outro_receb_pag', 'Outro recebimento/pagamento'] ] },
			{ label: 'Investimento — Pagamentos respeitantes a', fields: [
				['cf_inv_pag_tangiveis', 'Ativos fixos tangíveis'],
				['cf_inv_pag_intangiveis', 'Ativos intangíveis'],
				['cf_inv_pag_financeiros', 'Investimentos financeiros'],
				['cf_inv_pag_outros', 'Outros ativos'] ] },
			{ label: 'Investimento — Recebimentos provenientes de', fields: [
				['cf_inv_receb_tangiveis', 'Ativos fixos tangíveis'],
				['cf_inv_receb_intangiveis', 'Ativos intangíveis'],
				['cf_inv_receb_financeiros', 'Investimentos financeiros'],
				['cf_inv_receb_outros', 'Outros ativos'],
				['cf_inv_subsidios', 'Subsídios ao investimento'],
				['cf_inv_juros', 'Juros e rendimentos similares'],
				['cf_inv_dividendos', 'Dividendos'] ] },
			{ label: 'Financiamento — Recebimentos provenientes de', fields: [
				['cf_fin_receb_financiamentos', 'Financiamentos obtidos'],
				['cf_fin_receb_capital', 'Realizações de capital e outros instrumentos'],
				['cf_fin_receb_cobertura', 'Cobertura de prejuízos'],
				['cf_fin_receb_doacoes', 'Doações'],
				['cf_fin_receb_outras', 'Outras operações de financiamento'] ] },
			{ label: 'Financiamento — Pagamentos respeitantes a', fields: [
				['cf_fin_pag_financiamentos', 'Financiamentos obtidos'],
				['cf_fin_pag_juros', 'Juros e gastos similares'],
				['cf_fin_pag_dividendos', 'Dividendos'],
				['cf_fin_pag_reducoes', 'Reduções de capital e outros instrumentos'],
				['cf_fin_pag_outras', 'Outras operações de financiamento'] ] },
			{ label: 'Caixa e Equivalentes', fields: [
				['cf_caixa', 'Caixa e seus equivalentes (saldo inicial/final)'],
				['cf_efeito_cambio', 'Efeito das diferenças de câmbio'] ] }
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

	const pvar = (r) => {
		if (r.variation == null) return '<td class="num"></td>';
		const cls = r.status === 'good' ? 'vg' : (r.status === 'bad' ? 'vb' : 'vf');
		const diff = flt(r.variation);
		const arrow = Math.abs(diff) < 0.005 ? '' : (diff > 0 ? '▲' : '▼');
		const amt = (diff > 0 ? '+' : '') + fmt(diff);
		const pct = (r.variation_pct == null) ? '—' : ((r.variation_pct > 0 ? '+' : '') + flt(r.variation_pct).toFixed(1) + '%');
		return `<td class="num ${cls}">${arrow} ${pct} <span class="pp">${amt}</span></td>`;
	};

	let head, body;
	if (kind === 'bs') {
		head = `<tr>
				<th class="l" rowspan="2">Descrição</th><th class="n" rowspan="2">Notas</th>
				<th class="num" colspan="3">${esc(data.current_label)}</th>
				<th class="num" rowspan="2">${esc(data.previous_label)}<br><span class="sub">Valor líquido</span></th>
				<th class="num" rowspan="2">Variação</th>
			</tr>
			<tr><th class="num sub">Valor bruto</th><th class="num sub">Amortizações</th><th class="num sub">Valor líquido</th></tr>`;
		body = (data.rows || []).map((r) => {
			if (r.is_header) {
				const c = r.kind === 'header' ? 'sec' : 'subsec';
				return `<tr class="${c}"><td colspan="7">${esc(r.label)}</td></tr>`;
			}
			const c = r.strong ? 'grand' : (r.bold ? 'tot' : '');
			return `<tr class="${c}"><td class="l">${esc(r.label)}</td><td class="n">${esc(r.notas)}</td>
				<td class="num">${fmt(r.bruto)}</td><td class="num">${fmt(r.amort)}</td>
				<td class="num">${fmt(r.liquido)}</td><td class="num">${fmt(r.liquido_prev)}</td>${pvar(r)}</tr>`;
		}).join('');
	} else {
		head = `<tr>
				<th class="l">Descrição</th><th class="n">Notas</th>
				<th class="num">${esc(data.current_label)}<br><span class="sub">Valor líquido</span></th>
				<th class="num">${esc(data.previous_label)}<br><span class="sub">Valor líquido</span></th>
				<th class="num">Variação</th>
			</tr>`;
		body = (data.rows || []).map((r) => {
			if (r.line_type === 'Header') return `<tr class="sec"><td colspan="5">${esc(r.label)}</td></tr>`;
			const c = r.bold ? 'tot' : '';
			return `<tr class="${c}"><td class="l">${esc(r.label)}</td><td class="n">${esc(r.notas)}</td>
				<td class="num">${fmt(r.current)}</td><td class="num">${fmt(r.previous)}</td>${pvar(r)}</tr>`;
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
			td.vg { color: #059669; font-weight: 700; }
			td.vb { color: #dc2626; font-weight: 700; }
			td.vf { color: #9ca3af; }
			.pp { font-size: 10px; opacity: .85; margin-left: 3px; }
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

// --------------------------------------------------------------------------- //
// Shared: Excel export (exports exactly the rows currently displayed)
// --------------------------------------------------------------------------- //
isoft_insights.exportXlsx = function (title, columns, rows) {
	if (!rows || !rows.length) { frappe.msgprint(__('Nothing to export.')); return; }
	frappe.call({
		method: isoft_insights.METHOD + 'export_table_xlsx',
		args: { title: title, columns: JSON.stringify(columns), rows: JSON.stringify(rows) },
		freeze: true, freeze_message: __('Building Excel…')
	}).then((r) => {
		const res = r.message;
		if (!res || !res.content) { frappe.msgprint(__('Could not build the file.')); return; }
		const bin = atob(res.content);
		const arr = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
		const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = res.filename || 'export.xlsx';
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
	}).catch(() => frappe.msgprint(__('Could not export.')));
};

// --------------------------------------------------------------------------- //
// Shared: clean printable table (Print -> Save as PDF)
// --------------------------------------------------------------------------- //
// opts: { title, company, meta: [..lines..], columns: [{label, num}], rows: [[cell,..]], landscape }
isoft_insights.printTable = function (opts) {
	opts = opts || {};
	const esc = (s) => frappe.utils.escape_html(s == null ? '' : String(s));
	const cols = opts.columns || [];
	const rows = opts.rows || [];
	if (!rows.length) { frappe.msgprint(__('Nothing to print.')); return; }

	const head = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
	const body = rows.map((r) => `<tr>${r.map((cell, i) =>
		`<td class="${cols[i] && cols[i].num ? 'num' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('');

	const now = new Date();
	const stamp = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
	const metaLines = (opts.meta || []).map((m) => esc(m)).join('<br>');

	const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
		<style>
			* { box-sizing: border-box; }
			body { font-family: 'Inter', Arial, sans-serif; color:#1f2937; margin:24px 28px; font-size:11px; }
			.doc-head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #1f2937; padding-bottom:10px; }
			.company { font-size:17px; font-weight:800; }
			.title { font-size:13px; font-weight:700; margin-top:2px; }
			.meta { text-align:right; font-size:10px; color:#6b7280; line-height:1.5; }
			table { width:100%; border-collapse:collapse; margin-top:12px; }
			th, td { padding:4px 7px; border-bottom:1px solid #e5e7eb; }
			thead th { border-bottom:1.5px solid #1f2937; text-align:left; font-size:10px; background:#f3f4f6; }
			th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
			tbody tr:nth-child(even) td { background:#fafafa; }
			.foot { margin-top:14px; font-size:9px; color:#9ca3af; text-align:right; }
			thead { display:table-header-group; }
			tr { page-break-inside:avoid; }
			@media print { body { margin:10mm; } @page { size:A4 ${opts.landscape ? 'landscape' : 'portrait'}; } }
		</style></head>
		<body>
			<div class="doc-head">
				<div><div class="company">${esc(opts.company || '')}</div><div class="title">${esc(opts.title || '')}</div></div>
				<div class="meta">${metaLines}${metaLines ? '<br>' : ''}Emitido: ${esc(stamp)}</div>
			</div>
			<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
			<div class="foot">Isoft Insights · ${esc(opts.title || '')} · ${rows.length} linhas</div>
		</body></html>`;

	const w = window.open('', '_blank');
	if (!w) { frappe.msgprint(__('Please allow pop-ups to print.')); return; }
	w.document.open(); w.document.write(html); w.document.close(); w.focus();
	setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
};
