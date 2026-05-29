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
	{ key: 'settings',    label: 'Settings',    icon: 'fa-cog',         file: 'settings',    period: false }
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
			this.apply_theme(s.theme_color || 'Blue');

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
		const tabs = isoft_insights.VIEWS.map((v) => `
			<button class="ii-tab" data-view="${v.key}">
				<i class="fa ${v.icon}"></i> ${v.label}
			</button>`).join('');

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

		this.page.main.find('.ii-tab').on('click', function () {
			me.set_view($(this).data('view'));
		});
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

		this.page.main.find('.ii-tab').removeClass('active');
		this.page.main.find(`.ii-tab[data-view="${key}"]`).addClass('active');

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
			background: rgba(255, 255, 255, 0.88); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
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
		</style>`;
		$('head').append(css);
	}
};
