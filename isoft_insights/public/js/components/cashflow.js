(function () {
'use strict';
// Isoft Insights - Angola Demonstração de Fluxos de Caixa (direct method).
// Two columns: current fiscal year (N) vs previous (N-1). Structure/formulas are
// fixed in the backend; only the account per line is configured in the settings.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.cashflow = function (ctx) {
	const $c = ctx.$content;
	const state = ctx.app._cashflow || (ctx.app._cashflow = {});

	$c.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');

	Promise.all([
		ctx.api('get_cash_flow_config'),
		ctx.api('get_fiscal_years').catch(() => [])
	]).then(([cfg, fys]) => {
		state.cfg = cfg || {};
		state.fys = fys || [];
		if (!state.fy) state.fy = cfg.default_fiscal_year || (fys[0] && fys[0].name) || '';

		if (!cfg.configured) { renderEmpty(ctx, $c, cfg); return; }
		renderShell(ctx, $c, state);
		loadStatement(ctx, state);
	}).catch(() => $c.html(isoft_insights.util.empty('Could not load the Fluxos de Caixa.')));
};

function renderEmpty(ctx, $c, cfg) {
	const canManage = !!cfg.can_manage;
	$c.html(`
		<div class="ii-card" style="text-align:center;padding:48px 20px;">
			<i class="fa fa-exchange" style="font-size:40px;color:var(--ii-muted);margin-bottom:14px;"></i>
			<h3 style="font-weight:700;margin:0 0 6px;">No accounts mapped yet</h3>
			<p style="color:var(--ii-muted);max-width:480px;margin:0 auto 18px;">
				Map each line of the Demonstração de Fluxos de Caixa to its account in the settings, then come back here.
			</p>
			${canManage
				? `<button class="btn btn-primary" id="cf-config"><i class="fa fa-cog"></i> Configure accounts</button>`
				: `<p style="color:var(--ii-muted);font-size:12px;">Ask an Accounts Manager to configure it.</p>`}
		</div>`);
	$c.find('#cf-config').on('click', () =>
		isoft_insights.openReportSettings('cf', () => isoft_insights.views.cashflow(ctx)));
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
			<select class="form-control ii-input" id="cf-fy">${fyOpts}</select>
			<button class="btn btn-default ii-refresh" id="cf-reload" title="Refresh"><i class="fa fa-refresh"></i></button>
			<span style="flex:1 1 auto"></span>
			<button class="btn btn-default ii-refresh" id="cf-print" title="Print"><i class="fa fa-print"></i></button>
			${canManage ? `<button class="btn btn-default ii-refresh" id="cf-config" title="Configure lines"><i class="fa fa-cog"></i></button>` : ''}
		</div>
		<div id="cf-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
	`);

	$c.find('#cf-fy').on('change', function () { state.fy = $(this).val(); loadStatement(ctx, state); });
	$c.find('#cf-reload').on('click', () => loadStatement(ctx, state));
	$c.find('#cf-print').on('click', () => isoft_insights.printStatement('pl', state.data));
	$c.find('#cf-config').on('click', () =>
		isoft_insights.openReportSettings('cf', () => loadStatement(ctx, state)));
}

function loadStatement(ctx, state) {
	const $body = ctx.$content.find('#cf-body');
	$body.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
	ctx.api('get_angola_cash_flow', {
		fiscal_year: state.fy || null,
		company: ctx.app.state.company || null
	}).then((data) => { state.data = data; renderStatement(ctx, state, $body, data); })
		.catch(() => $body.html(isoft_insights.util.empty('Could not compute the Fluxos de Caixa.')));
}

// Angolan number format: space thousands separator, comma decimal, 2 places.
function fmt(value) {
	if (value == null || value === '') return '';
	const n = flt(value);
	const parts = Math.abs(n).toFixed(2).split('.');
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return (n < 0 ? '-' : '') + parts[0] + ',' + parts[1];
}

const neg = (v) => (flt(v) < 0 ? 'bs-neg' : '');

function varCell(r) {
	if (r.variation == null) return '<td class="bs-num"></td>';
	const cls = r.status === 'good' ? 'v-good' : (r.status === 'bad' ? 'v-bad' : 'v-flat');
	const diff = flt(r.variation);
	const arrow = Math.abs(diff) < 0.005 ? '' : (diff > 0 ? '▲' : '▼');
	const amt = (diff > 0 ? '+' : '') + fmt(diff);
	const pct = (r.variation_pct == null) ? '—'
		: `${r.variation_pct > 0 ? '+' : ''}${flt(r.variation_pct).toFixed(1)}%`;
	return `<td class="bs-num v-cell ${cls}"><span class="v-arrow">${arrow}</span> <span class="v-pct-main">${pct}</span> <span class="v-amt">${amt}</span></td>`;
}

function drillChildRow(n, rowcode, level) {
	const esc = isoft_insights.util.esc;
	const pad = 22 + level * 16;
	const dr = n.is_group ? 'cf-dr' : '';
	const caret = n.is_group ? '<i class="fa fa-chevron-right bs-caret"></i>' : '<i class="bs-caret-space"></i>';
	const nm = (n.number ? esc(n.number) + ' · ' : '') + esc(n.name);
	return `<tr class="bs-drill-child ${dr}" data-rowcode="${esc(rowcode)}" data-account="${esc(n.account)}" data-level="${level}">
		<td class="bs-label" style="padding-left:${pad}px">${caret}${nm}</td>
		<td class="bs-notas"></td>
		<td class="bs-num ${neg(n.current)}">${fmt(n.current)}</td>
		<td class="bs-num bs-prev ${neg(n.previous)}">${fmt(n.previous)}</td>
		${varCell(n)}
	</tr>`;
}

function removeSubtree($row, level) {
	let $n = $row.next();
	while ($n.length && $n.hasClass('bs-drill-child') && parseInt($n.attr('data-level') || '0', 10) > level) {
		const $next = $n.next(); $n.remove(); $n = $next;
	}
}

function toggleDrill(ctx, state, $row) {
	const level = parseInt($row.attr('data-level') || '0', 10);
	if ($row.hasClass('open')) {
		removeSubtree($row, level);
		$row.removeClass('open').find('.bs-caret').first().removeClass('down');
		return;
	}
	const rowcode = $row.attr('data-rowcode');
	const account = $row.attr('data-account') || null;
	const pad = 22 + (level + 1) * 16;
	const $load = $(`<tr class="bs-drill-child" data-level="${level + 1}"><td colspan="5" style="padding-left:${pad}px;color:var(--ii-muted);font-size:12px;"><i class="fa fa-spinner fa-spin"></i> A carregar…</td></tr>`);
	$row.after($load);
	$row.addClass('open').find('.bs-caret').first().addClass('down');
	ctx.api('drill_cash_flow', { row_code: rowcode, account: account, fiscal_year: state.fy || null, company: ctx.app.state.company || null })
		.then((res) => {
			$load.remove();
			const nodes = (res && res.rows) || [];
			if (!nodes.length) {
				$row.after(`<tr class="bs-drill-child" data-level="${level + 1}"><td colspan="5" style="padding-left:${pad}px;color:var(--ii-muted);font-size:12px;">Sem detalhe adicional.</td></tr>`);
				return;
			}
			$row.after(nodes.map((n) => drillChildRow(n, rowcode, level + 1)).join(''));
		})
		.catch(() => { $load.remove(); $row.removeClass('open').find('.bs-caret').first().removeClass('down'); });
}

function renderStatement(ctx, state, $body, data) {
	const esc = isoft_insights.util.esc;

	const rows = (data.rows || []).map((r) => {
		if (r.is_header) {
			const cls = r.kind === 'header' ? 'cf-section' : 'cf-subsection';
			// Keep Notas in its own column so it lines up with the data rows.
			return `<tr class="${cls}">
				<td class="bs-label">${esc(r.label)}</td>
				<td class="bs-notas">${esc(r.notas)}</td>
				<td colspan="3"></td>
			</tr>`;
		}
		let cls = r.strong ? 'cf-grand' : (r.bold ? 'bs-total' : '');
		if (r.drillable) cls += ' cf-dr';
		const caret = r.drillable ? '<i class="fa fa-chevron-right bs-caret"></i>' : '';
		const pad = 6 + (cint(r.indent) * 18);
		return `
			<tr class="${cls}" data-rowcode="${esc(r.row_code)}" data-level="0">
				<td class="bs-label" style="padding-left:${pad}px">${caret}${esc(r.label)}</td>
				<td class="bs-notas">${esc(r.notas)}</td>
				<td class="bs-num ${neg(r.current)}">${fmt(r.current)}</td>
				<td class="bs-num bs-prev ${neg(r.previous)}">${fmt(r.previous)}</td>
				${varCell(r)}
			</tr>`;
	}).join('');

	const diff = flt(data.difference);
	const badge = data.reconciled
		? `<span class="bs-badge ok"><i class="fa fa-check"></i> Caixa reconciliada</span>`
		: `<span class="bs-badge bad" title="Início + Variação + Câmbio vs Caixa no fim">
			<i class="fa fa-exclamation-triangle"></i> Diferença de ${esc(fmt(diff))}</span>`;

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
				<div>${badge}</div>
			</div>
			${warn}
			<div class="bs-table-wrap">
				<table class="bs-table">
					<thead>
						<tr>
							<th class="bs-label" rowspan="2">Rubricas</th>
							<th class="bs-notas" rowspan="2">Notas</th>
							<th class="bs-num" colspan="2">Datas</th>
							<th class="bs-num" rowspan="2">Variação<br><span class="bs-sublabel">${esc(data.current_label)} vs ${esc(data.previous_label)}</span></th>
						</tr>
						<tr class="bs-subhead">
							<th class="bs-num">${esc(data.current_label)}</th>
							<th class="bs-num">${esc(data.previous_label)}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		</div>
	`);
	injectStyles();
	$body.off('click', 'tr.cf-dr').on('click', 'tr.cf-dr', function () { toggleDrill(ctx, state, $(this)); });
}

// Only the cash-flow specifics; all shared statement styling lives in the app shell.
function injectStyles() {
	if (document.getElementById('ii-cf-styles')) return;
	const css = `
	<style id="ii-cf-styles">
	.bs-table tr.cf-section td { font-weight:800; text-transform:uppercase; font-size:11.5px; letter-spacing:.5px;
		color:var(--ii-primary); background:var(--ii-bg); border-top:2px solid var(--ii-border); padding:11px 14px; }
	.bs-table tr.cf-subsection td { font-weight:700; color:var(--ii-text); background:var(--ii-bg); font-size:12.5px; }
	.bs-table tr.cf-subsection td.bs-label { padding-left:22px; }
	.bs-table tr.cf-grand td { font-weight:800; background:var(--ii-bg); border-top:2px solid var(--ii-primary); border-bottom:2px solid var(--ii-primary); }
	.bs-table tr.cf-dr { cursor:pointer; }
	.bs-table tr.cf-dr:hover td { background:var(--ii-bg); }
	.bs-table tr.cf-section:hover td, .bs-table tr.cf-subsection:hover td { background:var(--ii-bg); }
	</style>`;
	$('head').append(css);
}
})();
