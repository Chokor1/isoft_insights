(function () {
'use strict';
// Isoft Insights - Angola income statement (Demonstração de Resultados por Naturezas).
// Data-driven two-column (current vs previous fiscal year) statement. The line
// structure is configured in "Isoft Angola Income Statement Settings".
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.balancesheet = function (ctx) {
	const esc = isoft_insights.util.esc;
	const $c = ctx.$content;
	const state = ctx.app._angola || (ctx.app._angola = {});

	$c.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');

	Promise.all([
		ctx.api('get_angola_pl_config'),
		ctx.api('get_fiscal_years').catch(() => [])
	]).then(([cfg, fys]) => {
		state.cfg = cfg || {};
		state.fys = fys || [];
		if (!state.fy) state.fy = cfg.default_fiscal_year || (fys[0] && fys[0].name) || '';

		if (!cfg.configured) {
			renderEmpty(ctx, $c, cfg);
			return;
		}
		renderShell(ctx, $c, state);
		loadStatement(ctx, state);
	}).catch(() => $c.html(isoft_insights.util.empty('Could not load the Angola statement.')));
};

function renderEmpty(ctx, $c, cfg) {
	const canManage = !!cfg.can_manage;
	$c.html(`
		<div class="ii-card" style="text-align:center;padding:48px 20px;">
			<i class="fa fa-file-text-o" style="font-size:40px;color:var(--ii-muted);margin-bottom:14px;"></i>
			<h3 style="font-weight:700;margin:0 0 6px;">No accounts mapped yet</h3>
			<p style="color:var(--ii-muted);max-width:480px;margin:0 auto 18px;">
				Map each line of the Demonstração de Resultados to its account in the settings, then come back here.
			</p>
			${canManage
				? `<button class="btn btn-primary" id="bs-config"><i class="fa fa-cog"></i> Configure accounts</button>`
				: `<p style="color:var(--ii-muted);font-size:12px;">Ask an Accounts Manager to configure it.</p>`}
		</div>`);

	$c.find('#bs-config').on('click', () =>
		isoft_insights.openReportSettings('pl', () => isoft_insights.views.balancesheet(ctx)));
}

function renderShell(ctx, $c, state) {
	const esc = isoft_insights.util.esc;
	const fyOpts = (state.fys || [])
		.map((f) => `<option value="${esc(f.name)}" ${f.name === state.fy ? 'selected' : ''}>${esc(f.name)}</option>`)
		.join('') || '<option value="">No Fiscal Year</option>';
	const canManage = !!(state.cfg && state.cfg.can_manage);

	$c.html(`
		<div class="ii-rowfilters">
			<label>Fiscal Year</label>
			<select class="form-control ii-input" id="bs-fy">${fyOpts}</select>
			<button class="btn btn-default ii-refresh" id="bs-reload" title="Refresh"><i class="fa fa-refresh"></i></button>
			<span style="flex:1 1 auto"></span>
			<button class="btn btn-default ii-refresh" id="bs-print" title="Print"><i class="fa fa-print"></i></button>
			${canManage ? `<button class="btn btn-default ii-refresh" id="bs-config" title="Configure lines"><i class="fa fa-cog"></i></button>` : ''}
		</div>
		<div id="bs-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
	`);

	$c.find('#bs-fy').on('change', function () { state.fy = $(this).val(); loadStatement(ctx, state); });
	$c.find('#bs-reload').on('click', () => loadStatement(ctx, state));
	$c.find('#bs-print').on('click', () => isoft_insights.printStatement('pl', state.data));
	$c.find('#bs-config').on('click', () =>
		isoft_insights.openReportSettings('pl', () => loadStatement(ctx, state)));
}

function loadStatement(ctx, state) {
	const $body = ctx.$content.find('#bs-body');
	$body.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
	ctx.api('get_angola_income_statement', {
		fiscal_year: state.fy || null,
		company: ctx.app.state.company || null
	}).then((data) => { state.data = data; renderStatement($body, data); })
		.catch(() => $body.html(isoft_insights.util.empty('Could not compute the statement.')));
}

// Angolan number format: space thousands separator, comma decimal, 2 places.
function fmt(value) {
	if (value == null || value === '') return '';
	const n = flt(value);
	const parts = Math.abs(n).toFixed(2).split('.');
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return (n < 0 ? '-' : '') + parts[0] + ',' + parts[1];
}

function varCell(r) {
	if (r.variation == null) return '<td class="bs-num"></td>';
	const cls = r.status === 'good' ? 'v-good' : (r.status === 'bad' ? 'v-bad' : 'v-flat');
	const diff = flt(r.variation);
	const arrow = Math.abs(diff) < 0.005 ? '' : (diff > 0 ? '▲' : '▼');
	const amt = (diff > 0 ? '+' : '') + fmt(diff);
	const pct = (r.variation_pct == null)
		? '—'
		: `${r.variation_pct > 0 ? '+' : ''}${flt(r.variation_pct).toFixed(1)}%`;
	return `<td class="bs-num v-cell ${cls}"><span class="v-arrow">${arrow}</span> <span class="v-pct-main">${pct}</span> <span class="v-amt">${amt}</span></td>`;
}

function renderStatement($body, data) {
	const esc = isoft_insights.util.esc;
	const cur = data.currency;
	const rows = (data.rows || []).map((r) => {
		if (r.line_type === 'Header') {
			return `<tr class="bs-header"><td colspan="2">${esc(r.label)}</td><td colspan="3">${esc(r.notas)}</td></tr>`;
		}
		const cls = r.bold ? 'bs-total' : '';
		const neg = (v) => (flt(v) < 0 ? 'bs-neg' : '');
		const pad = 6 + (cint(r.indent) * 18);
		return `
			<tr class="${cls}">
				<td class="bs-label" style="padding-left:${pad}px">${esc(r.label)}</td>
				<td class="bs-notas">${esc(r.notas)}</td>
				<td class="bs-num ${neg(r.current)}">${fmt(r.current)}</td>
				<td class="bs-num bs-prev ${neg(r.previous)}">${fmt(r.previous)}</td>
				${varCell(r)}
			</tr>`;
	}).join('');

	const warn = (data.missing_accounts || []).length
		? `<div class="bs-warn"><i class="fa fa-exclamation-triangle"></i>
			Accounts not found in <b>${esc(data.company)}</b>: ${esc((data.missing_accounts || []).join(', '))}.
			These lines were treated as 0.</div>`
		: '';

	$body.html(`
		<div class="ii-card bs-card">
			<div class="bs-head">
				<div>
					<div class="bs-title">${esc(data.title)}</div>
					<div class="bs-sub">${esc(data.company)} · ${esc(cur)} · FY ${esc(data.fiscal_year)}</div>
				</div>
			</div>
			${warn}
			<div class="bs-table-wrap">
				<table class="bs-table">
					<thead>
						<tr>
							<th class="bs-label" rowspan="2">Descrição</th>
							<th class="bs-notas" rowspan="2">Notas</th>
							<th class="bs-num">${esc(data.current_label)}</th>
							<th class="bs-num">${esc(data.previous_label)}</th>
							<th class="bs-num" rowspan="2">Variação<br><span class="bs-sublabel">${esc(data.current_label)} vs ${esc(data.previous_label)}</span></th>
						</tr>
						<tr class="bs-subhead">
							<th class="bs-num">Valor líquido</th>
							<th class="bs-num">Valor líquido</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		</div>
	`);
	injectStyles();
}

function injectStyles() {
	if (document.getElementById('ii-bs-styles')) return;
	const css = `
	<style id="ii-bs-styles">
	.bs-card { padding: 0; overflow: hidden; }
	.bs-head { display:flex; align-items:center; justify-content:space-between; padding:18px 20px; border-bottom:1px solid var(--ii-border); }
	.bs-title { font-size:16px; font-weight:800; }
	.bs-sub { font-size:12px; color:var(--ii-muted); margin-top:3px; text-transform:uppercase; letter-spacing:.4px; }
	.bs-warn { margin:12px 20px 0; padding:9px 12px; border-radius:8px; font-size:12.5px;
		background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
	.bs-warn i { margin-right:6px; }
	.bs-table-wrap { overflow-x:auto; padding:8px 4px 12px; }
	.bs-table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:560px; }
	.bs-table th { text-align:left; color:var(--ii-text); font-weight:700; font-size:12.5px;
		padding:8px 14px; border-bottom:1px solid var(--ii-border); }
	.bs-table thead tr:first-child th { border-bottom:none; padding-bottom:2px; }
	.bs-table tr.bs-subhead th { font-weight:500; color:var(--ii-muted); font-size:11.5px; padding-top:0;
		border-bottom:2px solid var(--ii-border); }
	.bs-table th.bs-num, .bs-table td.bs-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
	.bs-table td { padding:9px 14px; border-bottom:1px solid var(--ii-border); }
	.bs-table td.bs-notas, .bs-table th.bs-notas { width:64px; color:var(--ii-muted); font-size:12px; }
	.bs-table td.bs-label { color:var(--ii-text); }
	.bs-table td.bs-prev { color:var(--ii-muted); }
	.bs-table tr.bs-total td { font-weight:800; background:var(--ii-bg); border-top:1px solid var(--ii-border); }
	.bs-table tr.bs-header td { font-weight:700; text-transform:uppercase; font-size:11.5px; letter-spacing:.5px;
		color:var(--ii-primary); background:var(--ii-bg); padding-top:12px; }
	.bs-table td.bs-neg { color:#dc2626; }
	.bs-table tbody tr:hover td { background:var(--ii-bg); }
	.bs-sublabel { font-weight:500; color:var(--ii-muted); font-size:10px; }
	.v-cell { font-weight:700; }
	.v-cell .v-arrow { font-size:10px; margin-right:1px; }
	.v-cell .v-pct-main { font-weight:700; font-size:13.5px; }
	.v-cell .v-amt { font-weight:500; font-size:11px; opacity:.75; margin-left:5px; }
	.v-good { color:#059669; }
	.v-bad { color:#dc2626; }
	.v-flat { color:var(--ii-muted); }
	@media print {
		.ii-bar, .ii-rowfilters { display:none !important; }
		.bs-card { box-shadow:none; border:none; }
	}
	</style>`;
	$('head').append(css);
}
})();
