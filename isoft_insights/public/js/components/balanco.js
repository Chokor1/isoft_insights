(function () {
'use strict';
// Isoft Insights - Angola Balanço (Balance Sheet).
// Four value columns: current year (Valor bruto | Amortizações | Valor líquido)
// and previous year (Valor líquido). Structure/formulas are fixed in the backend;
// only the account per line is configured in "Isoft Angola Balance Sheet Settings".
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.balanco = function (ctx) {
	const $c = ctx.$content;
	const state = ctx.app._balanco || (ctx.app._balanco = {});

	$c.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');

	Promise.all([
		ctx.api('get_balance_sheet_config'),
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
	}).catch(() => $c.html(isoft_insights.util.empty('Could not load the Balanço.')));
};

function renderEmpty(ctx, $c, cfg) {
	const esc = isoft_insights.util.esc;
	const canManage = !!cfg.can_manage;
	$c.html(`
		<div class="ii-card" style="text-align:center;padding:48px 20px;">
			<i class="fa fa-balance-scale" style="font-size:40px;color:var(--ii-muted);margin-bottom:14px;"></i>
			<h3 style="font-weight:700;margin:0 0 6px;">No accounts mapped yet</h3>
			<p style="color:var(--ii-muted);max-width:480px;margin:0 auto 18px;">
				Map each line of the Balanço to its account in the settings, then come back here.
			</p>
			${canManage
				? `<button class="btn btn-primary" id="bs2-config"><i class="fa fa-cog"></i> Configure accounts</button>`
				: `<p style="color:var(--ii-muted);font-size:12px;">Ask an Accounts Manager to configure it.</p>`}
		</div>`);
	$c.find('#bs2-config').on('click', () =>
		isoft_insights.openReportSettings('bs', () => isoft_insights.views.balanco(ctx)));
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
			<select class="form-control ii-input" id="bs2-fy">${fyOpts}</select>
			<button class="btn btn-default ii-refresh" id="bs2-reload" title="Refresh"><i class="fa fa-refresh"></i></button>
			<span style="flex:1 1 auto"></span>
			<button class="btn btn-default ii-refresh" id="bs2-print" title="Print"><i class="fa fa-print"></i></button>
			${canManage ? `<button class="btn btn-default ii-refresh" id="bs2-config" title="Configure lines"><i class="fa fa-cog"></i></button>` : ''}
		</div>
		<div id="bs2-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
	`);

	$c.find('#bs2-fy').on('change', function () { state.fy = $(this).val(); loadStatement(ctx, state); });
	$c.find('#bs2-reload').on('click', () => loadStatement(ctx, state));
	$c.find('#bs2-print').on('click', () => isoft_insights.printStatement('bs', state.data));
	$c.find('#bs2-config').on('click', () =>
		isoft_insights.openReportSettings('bs', () => loadStatement(ctx, state)));
}

function loadStatement(ctx, state) {
	const $body = ctx.$content.find('#bs2-body');
	$body.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
	ctx.api('get_angola_balance_sheet', {
		fiscal_year: state.fy || null,
		company: ctx.app.state.company || null
	}).then((data) => { state.data = data; renderStatement($body, data); })
		.catch(() => $body.html(isoft_insights.util.empty('Could not compute the Balanço.')));
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
	const neg = (v) => (flt(v) < 0 ? 'bs-neg' : '');

	const rows = (data.rows || []).map((r) => {
		if (r.is_header) {
			const cls = r.kind === 'header' ? 'bs-section' : 'bs-subsection';
			return `<tr class="${cls}"><td colspan="7">${esc(r.label)}</td></tr>`;
		}
		let cls = '';
		if (r.strong) cls = 'bs-grand';
		else if (r.bold) cls = 'bs-total';
		return `
			<tr class="${cls}">
				<td class="bs-label">${esc(r.label)}</td>
				<td class="bs-notas">${esc(r.notas)}</td>
				<td class="bs-num ${neg(r.bruto)}">${fmt(r.bruto)}</td>
				<td class="bs-num ${neg(r.amort)}">${fmt(r.amort)}</td>
				<td class="bs-num ${neg(r.liquido)}">${fmt(r.liquido)}</td>
				<td class="bs-num bs-prev ${neg(r.liquido_prev)}">${fmt(r.liquido_prev)}</td>
				${varCell(r)}
			</tr>`;
	}).join('');

	const diff = flt(data.difference);
	const balBadge = data.balanced
		? `<span class="bs-badge ok"><i class="fa fa-check"></i> Activo = Capital Próprio e Passivo</span>`
		: `<span class="bs-badge bad"><i class="fa fa-exclamation-triangle"></i> Out of balance by ${esc(fmt(diff))}</span>`;

	const warn = (data.missing_accounts || []).length
		? `<div class="bs-warn"><i class="fa fa-exclamation-triangle"></i>
			Accounts not found in <b>${esc(data.company)}</b>: ${esc((data.missing_accounts || []).join(', '))}.</div>`
		: '';

	$body.html(`
		<div class="ii-card bs-card">
			<div class="bs-head">
				<div>
					<div class="bs-title">${esc(data.title)}</div>
					<div class="bs-sub">${esc(data.company)} · ${esc(data.currency)} · FY ${esc(data.fiscal_year)}</div>
				</div>
				<div>${balBadge}</div>
			</div>
			${warn}
			<div class="bs-table-wrap">
				<table class="bs-table bs-table-4">
					<thead>
						<tr>
							<th class="bs-label" rowspan="2">Descrição</th>
							<th class="bs-notas" rowspan="2">Notas</th>
							<th class="bs-num" colspan="3">${esc(data.current_label)}</th>
							<th class="bs-num" rowspan="2">${esc(data.previous_label)}<br><span class="bs-sublabel">Valor líquido</span></th>
							<th class="bs-num" rowspan="2">Variação<br><span class="bs-sublabel">${esc(data.current_label)} vs ${esc(data.previous_label)}</span></th>
						</tr>
						<tr class="bs-subhead">
							<th class="bs-num">Valor bruto</th>
							<th class="bs-num">Amortizações</th>
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
	if (document.getElementById('ii-bs2-styles')) return;
	const css = `
	<style id="ii-bs2-styles">
	.bs-card { padding: 0; overflow: hidden; }
	.bs-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:18px 20px; border-bottom:1px solid var(--ii-border); flex-wrap:wrap; }
	.bs-title { font-size:16px; font-weight:800; }
	.bs-sub { font-size:12px; color:var(--ii-muted); margin-top:3px; text-transform:uppercase; letter-spacing:.4px; }
	.bs-badge { font-size:12px; font-weight:700; padding:5px 10px; border-radius:20px; white-space:nowrap; }
	.bs-badge.ok { background:#dcfce7; color:#166534; }
	.bs-badge.bad { background:#fee2e2; color:#991b1b; }
	.bs-warn { margin:12px 20px 0; padding:9px 12px; border-radius:8px; font-size:12.5px; background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
	.bs-warn i { margin-right:6px; }
	.bs-table-wrap { overflow-x:auto; padding:8px 4px 12px; }
	.bs-table-4 { width:100%; border-collapse:collapse; font-size:13px; min-width:760px; }
	.bs-table-4 th { text-align:left; color:var(--ii-text); font-weight:700; font-size:12.5px; padding:8px 12px; border-bottom:1px solid var(--ii-border); }
	.bs-table-4 thead tr:first-child th { border-bottom:none; padding-bottom:2px; }
	.bs-table-4 tr.bs-subhead th { font-weight:500; color:var(--ii-muted); font-size:11.5px; padding-top:0; border-bottom:2px solid var(--ii-border); }
	.bs-table-4 th.bs-num, .bs-table-4 td.bs-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
	.bs-table-4 .bs-sublabel { font-weight:500; color:var(--ii-muted); font-size:11px; }
	.bs-table-4 td { padding:8px 12px; border-bottom:1px solid var(--ii-border); }
	.bs-table-4 td.bs-notas, .bs-table-4 th.bs-notas { width:52px; color:var(--ii-muted); font-size:12px; }
	.bs-table-4 td.bs-prev { color:var(--ii-muted); }
	.bs-table-4 tr.bs-section td { font-weight:800; text-transform:uppercase; font-size:12px; letter-spacing:.6px; color:var(--ii-primary); background:var(--ii-bg); padding:11px 12px; border-top:2px solid var(--ii-border); }
	.bs-table-4 tr.bs-subsection td { font-weight:700; color:var(--ii-text); background:var(--ii-bg); font-size:12.5px; }
	.bs-table-4 tr.bs-total td { font-weight:800; background:var(--ii-bg); }
	.bs-table-4 tr.bs-grand td { font-weight:800; background:var(--ii-bg); border-top:2px solid var(--ii-primary); border-bottom:2px solid var(--ii-primary); }
	.bs-table-4 td.bs-neg { color:#dc2626; }
	.bs-table-4 tbody tr:not(.bs-section):not(.bs-subsection):hover td { background:var(--ii-bg); }
	.bs-table-4 .v-cell { font-weight:700; }
	.bs-table-4 .v-cell .v-arrow { font-size:10px; margin-right:1px; }
	.bs-table-4 .v-cell .v-pct-main { font-weight:700; font-size:13.5px; }
	.bs-table-4 .v-cell .v-amt { font-weight:500; font-size:11px; opacity:.75; margin-left:5px; }
	.bs-table-4 .v-good { color:#059669; }
	.bs-table-4 .v-bad { color:#dc2626; }
	.bs-table-4 .v-flat { color:var(--ii-muted); }
	@media print { .ii-bar, .ii-rowfilters { display:none !important; } .bs-card { box-shadow:none; border:none; } }
	</style>`;
	$('head').append(css);
}
})();
