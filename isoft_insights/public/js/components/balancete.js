(function () {
'use strict';
// Isoft Insights - Balancete Geral (PGC Angola trial balance).
// Every row comes from the company's own chart of accounts; the backend only
// rolls the ledger up the tree, so nothing here assumes a numbering scheme.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

const esc = (s) => isoft_insights.util.esc(s);

// Angolan number format: space thousands separator, comma decimals, 2 places.
function fmt(value) {
	if (value == null || value === '') return '';
	const n = flt(value);
	const parts = Math.abs(n).toFixed(2).split('.');
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return (n < 0 ? '-' : '') + parts[0] + ',' + parts[1];
}

function cell(value) {
	if (value == null || value === '') return '<td class="bg-num"></td>';
	const zero = Math.abs(flt(value)) < 0.005;
	return `<td class="bg-num${zero ? ' bg-z' : ''}">${fmt(value)}</td>`;
}

isoft_insights.views.balancete = function (ctx) {
	injectStyles();

	const st = ctx.state.balancete = ctx.state.balancete || {
		from_date: firstDayOfYear(),
		to_date: frappe.datetime.get_today(),
		voucher_type: '',
		max_depth: 0,
		only_with_movement: 1,
		include_opening: 0,
		search: ''
	};

	ctx.$content.html(`
		<div class="ii-card">
			<div class="ii-rowfilters">
				<label>De</label>
				<input type="date" class="form-control ii-input" id="bg-from" value="${esc(st.from_date)}">
				<label>Até</label>
				<input type="date" class="form-control ii-input" id="bg-to" value="${esc(st.to_date)}">
				<label>Lançamento</label>
				<select class="form-control ii-input" id="bg-vt"></select>
				<label>Nível</label>
				<select class="form-control ii-input" id="bg-depth"></select>
				<label class="bg-check"><input type="checkbox" id="bg-moved" ${st.only_with_movement ? 'checked' : ''}> Só com movimento</label>
				<label class="bg-check"><input type="checkbox" id="bg-open" ${st.include_opening ? 'checked' : ''}> Saldo inicial</label>
				<span class="bg-tools">
					<input type="text" class="form-control ii-input ii-search" id="bg-search" placeholder="Procurar conta…" value="${esc(st.search)}">
					<button class="btn btn-default ii-refresh" id="bg-reload" title="Actualizar"><i class="fa fa-refresh"></i></button>
					<button class="btn btn-default ii-refresh" id="bg-xlsx" title="Exportar para Excel"><i class="fa fa-file-excel-o"></i></button>
					<button class="btn btn-default ii-refresh" id="bg-print" title="Imprimir"><i class="fa fa-print"></i></button>
				</span>
			</div>
			<div id="bg-kpis"></div>
			<div id="bg-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
		</div>
	`);

	let data = null;

	const company = () => ctx.app.state.company || null;

	const fillSelects = () => {
		const vts = (data && data.voucher_types) || [];
		ctx.$content.find('#bg-vt').html(
			`<option value="">&lt;TODOS&gt;</option>` +
			vts.map((v) => `<option value="${esc(v)}" ${v === st.voucher_type ? 'selected' : ''}>${esc(v)}</option>`).join('')
		);
		const depth = Math.max((data && data.depth) || 1, cint(st.max_depth) || 1);
		let opts = `<option value="0" ${!cint(st.max_depth) ? 'selected' : ''}>Todos</option>`;
		for (let i = 1; i <= depth; i++) {
			opts += `<option value="${i}" ${cint(st.max_depth) === i ? 'selected' : ''}>${i}</option>`;
		}
		ctx.$content.find('#bg-depth').html(opts);
	};

	const renderKpis = () => {
		const t = (data && data.totals) || {};
		const balanced = Math.abs(flt(t.debit) - flt(t.credit)) < 0.005;
		ctx.$content.find('#bg-kpis').html(`
			<div class="ii-grid" style="margin-bottom:8px;">
				<div class="ii-kpi"><div class="ii-kpi-label">Mov. Débito</div><div class="ii-kpi-value">${fmt(t.debit)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">Mov. Crédito</div><div class="ii-kpi-value">${fmt(t.credit)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">Saldo Devedor</div><div class="ii-kpi-value" style="color:var(--ii-ok)">${fmt(t.saldo_debit)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">Saldo Credor</div><div class="ii-kpi-value" style="color:var(--ii-bad)">${fmt(t.saldo_credit)}</div></div>
				<div class="ii-kpi">
					<div class="ii-kpi-label">Balanceamento</div>
					<div class="ii-kpi-value" style="color:${balanced ? 'var(--ii-ok)' : 'var(--ii-bad)'}">
						<i class="fa fa-${balanced ? 'check-circle' : 'exclamation-triangle'}"></i>
						${balanced ? 'Certo' : fmt(flt(t.debit) - flt(t.credit))}
					</div>
				</div>
			</div>
		`);
	};

	const columns = () => {
		const cols = [['Conta', ''], ['Descrição', '']];
		if (data && cint(data.include_opening)) {
			cols.push(['Saldo Ant. Débito', 'num'], ['Saldo Ant. Crédito', 'num']);
		}
		cols.push(['Mov. Débito', 'num'], ['Mov. Crédito', 'num'], ['Saldo Débito', 'num'], ['Saldo Crédito', 'num']);
		return cols;
	};

	const visibleRows = () => {
		const term = (st.search || '').toLowerCase().trim();
		if (!term) return (data && data.rows) || [];
		return ((data && data.rows) || []).filter((r) =>
			r.kind === 'account' &&
			((r.number || '').toLowerCase().includes(term) || (r.name || '').toLowerCase().includes(term)));
	};

	const rowHtml = (r) => {
		const opening = cint(data.include_opening);
		const money = opening
			? [r.opening_debit, r.opening_credit, r.debit, r.credit, r.saldo_debit, r.saldo_credit]
			: [r.debit, r.credit, r.saldo_debit, r.saldo_credit];

		if (r.kind === 'account') {
			const pad = 10 + r.level * 18;
			const caret = r.has_children
				? '<i class="fa fa-chevron-right bg-caret"></i>'
				: '<i class="bg-caret-space"></i>';
			return `<tr class="bg-row${r.is_group ? ' bg-grp' : ''}" data-account="${esc(r.account)}" data-level="${r.level}">
				<td class="bg-code" style="padding-left:${pad}px">${caret}${esc(r.number)}</td>
				<td class="bg-name">${esc(r.name)}</td>
				${money.map(cell).join('')}
			</tr>`;
		}

		const isTotal = r.kind === 'total' || r.kind === 'total_saldos';
		return `<tr class="bg-sum${isTotal ? ' bg-sum-grand' : ''}">
			<td colspan="2" class="bg-sum-label">${esc(r.label)}</td>
			${money.map(cell).join('')}
		</tr>`;
	};

	const paint = () => {
		const rows = visibleRows();
		const cols = columns();
		const $body = ctx.$content.find('#bg-body');
		if (!rows.length) {
			$body.html(isoft_insights.util.empty(
				st.search ? 'Nenhuma conta corresponde à procura.' : 'Sem movimentos no período seleccionado.'));
			return;
		}
		const note = st.search
			? 'filtro activo · somas ocultas'
			: 'clique numa conta para ver os lançamentos';
		$body.html(`
			<div class="ii-card-title" style="margin:8px 0 10px;">
				<i class="fa fa-list-ol"></i> Balancete Geral
				<span class="ii-pill">${esc(note)}</span>
			</div>
			<div class="bg-printhead">
				<div class="bg-print-co">${esc(data.company || '')}</div>
				<div>Balancete Geral · ${esc(data.from_date)} a ${esc(data.to_date)}
					· Lançamento: ${esc(data.voucher_type || '<TODOS>')} · ${esc(data.currency || '')}</div>
			</div>
			<table class="ii-table bg-table">
				<thead><tr>${cols.map(([label, cls]) => `<th class="${cls === 'num' ? 'bg-num' : ''}">${esc(label)}</th>`).join('')}</tr></thead>
				<tbody>${rows.map(rowHtml).join('')}</tbody>
			</table>
		`);
	};

	const load = () => {
		ctx.$content.find('#bg-body').html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_balancete_geral', {
			from_date: st.from_date || null,
			to_date: st.to_date || null,
			company: company(),
			voucher_type: st.voucher_type || null,
			only_with_movement: st.only_with_movement ? 1 : 0,
			include_opening: st.include_opening ? 1 : 0,
			max_depth: cint(st.max_depth) || 0
		}).then((res) => {
			data = res || { rows: [], totals: {} };
			st.from_date = data.from_date || st.from_date;
			st.to_date = data.to_date || st.to_date;
			ctx.$content.find('#bg-from').val(st.from_date);
			ctx.$content.find('#bg-to').val(st.to_date);
			fillSelects();
			renderKpis();
			paint();
		}).catch(() => {
			ctx.$content.find('#bg-kpis').empty();
			ctx.$content.find('#bg-body').html(isoft_insights.util.empty('Não foi possível calcular o Balancete.'));
		});
	};

	// ---- filters ----
	ctx.$content.find('#bg-from').on('change', function () { st.from_date = $(this).val(); load(); });
	ctx.$content.find('#bg-to').on('change', function () { st.to_date = $(this).val(); load(); });
	ctx.$content.find('#bg-vt').on('change', function () { st.voucher_type = $(this).val(); load(); });
	ctx.$content.find('#bg-depth').on('change', function () { st.max_depth = cint($(this).val()); load(); });
	ctx.$content.find('#bg-moved').on('change', function () { st.only_with_movement = $(this).prop('checked') ? 1 : 0; load(); });
	ctx.$content.find('#bg-open').on('change', function () { st.include_opening = $(this).prop('checked') ? 1 : 0; load(); });
	ctx.$content.find('#bg-search').on('input', function () { st.search = $(this).val(); paint(); });
	ctx.$content.find('#bg-reload').on('click', load);
	ctx.$content.find('#bg-print').on('click', () => window.print());
	ctx.$content.find('#bg-xlsx').on('click', () => exportXlsx(ctx, data, columns()));

	// ---- drill-down: the ledger lines behind a row ----
	ctx.$content.off('click', '.bg-row').on('click', '.bg-row', function () {
		const $row = $(this);
		const $open = $row.next('.bg-drill');
		if ($open.length) { $open.remove(); $row.removeClass('open'); return; }
		ctx.$content.find('.bg-drill').remove();
		ctx.$content.find('.bg-row').removeClass('open');
		$row.addClass('open');

		const span = columns().length;
		const $detail = $(`<tr class="bg-drill"><td colspan="${span}">
			<div class="ii-loading" style="padding:16px"><i class="fa fa-spinner fa-spin"></i> A carregar lançamentos…</div></td></tr>`);
		$row.after($detail);

		ctx.api('get_balancete_entries', {
			account: $row.data('account'),
			from_date: st.from_date || null,
			to_date: st.to_date || null,
			company: company(),
			voucher_type: st.voucher_type || null
		}).then((res) => $detail.find('td').html(entriesHtml(res)))
			.catch(() => $detail.find('td').html('<div style="color:var(--ii-muted)">Não foi possível carregar os lançamentos.</div>'));
	});

	ctx.$content.off('click', '.bg-voucher').on('click', '.bg-voucher', function (e) {
		e.stopPropagation();
		const route = frappe.router.slug($(this).data('doctype'));
		window.open(`/app/${route}/${encodeURIComponent($(this).data('name'))}`, '_blank', 'noopener');
	});

	load();
};

function entriesHtml(res) {
	const rows = (res && res.rows) || [];
	if (!rows.length) return '<div style="color:var(--ii-muted);font-size:12px;">Sem lançamentos no período.</div>';
	const lines = rows.map((e) => `
		<tr>
			<td>${esc(e.posting_date)}</td>
			<td><a href="#" class="bg-voucher" data-doctype="${esc(e.voucher_type)}" data-name="${esc(e.voucher_no)}">${esc(e.voucher_no)}</a>
				<span class="bg-vt">${esc(e.voucher_type)}</span></td>
			<td>${esc(e.account)}</td>
			<td>${esc(e.party || '')}</td>
			<td class="bg-rem">${esc((e.remarks || '').slice(0, 90))}</td>
			<td class="bg-num">${fmt(e.debit)}</td>
			<td class="bg-num">${fmt(e.credit)}</td>
		</tr>`).join('');
	const more = cint(res.truncated)
		? '<div class="bg-trunc">Apenas os primeiros lançamentos são mostrados. Reduza o período para ver o resto.</div>'
		: '';
	return `<table class="bg-subtable">
		<thead><tr><th>Data</th><th>Documento</th><th>Conta</th><th>Entidade</th><th>Descrição</th>
			<th class="bg-num">Débito</th><th class="bg-num">Crédito</th></tr></thead>
		<tbody>${lines}</tbody></table>${more}`;
}

function exportXlsx(ctx, data, cols) {
	if (!data || !(data.rows || []).length) {
		frappe.show_alert({ message: 'Nada para exportar.', indicator: 'orange' });
		return;
	}
	const opening = cint(data.include_opening);
	const body = data.rows.map((r) => {
		const money = opening
			? [r.opening_debit, r.opening_credit, r.debit, r.credit, r.saldo_debit, r.saldo_credit]
			: [r.debit, r.credit, r.saldo_debit, r.saldo_credit];
		const head = r.kind === 'account'
			? ['    '.repeat(r.level) + (r.number || ''), r.name || '']
			: [r.label || '', ''];
		return head.concat(money.map((v) => (v == null ? '' : flt(v))));
	});
	ctx.api('export_table_xlsx', {
		title: `Balancete Geral ${data.from_date} a ${data.to_date}`,
		columns: JSON.stringify(cols.map(([label]) => label)),
		rows: JSON.stringify(body)
	}).then((res) => {
		if (!res || !res.content) throw new Error('empty');
		const bytes = atob(res.content);
		const buf = new Uint8Array(bytes.length);
		for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
		const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = res.filename || 'balancete.xlsx';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}).catch(() => frappe.show_alert({ message: 'Falhou a exportação.', indicator: 'red' }));
}

function firstDayOfYear() {
	return frappe.datetime.get_today().slice(0, 4) + '-01-01';
}

function injectStyles() {
	if (document.getElementById('ii-balancete-styles')) return;
	$('head').append(`<style id="ii-balancete-styles">
		.bg-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ii-muted); font-weight: 600; margin: 0 0 0 6px; }
		.bg-tools { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
		.bg-tools .ii-search { width: 190px; }
		.bg-table td, .bg-table th { padding: 6px 12px; }
		.bg-table .bg-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
		.bg-table .bg-z { color: var(--ii-faint); }
		.bg-table .bg-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: nowrap; }
		.bg-table .bg-name { color: var(--ii-text-2); }
		.bg-table tr.bg-grp > td.bg-code, .bg-table tr.bg-grp > td.bg-name { font-weight: 700; color: var(--ii-text); }
		.bg-table tr.bg-row { cursor: pointer; }
		.bg-table tr.bg-row.open > td { background: var(--ii-soft); }
		.bg-caret { color: var(--ii-muted); font-size: 10px; margin-right: 7px; display: inline-block; transition: transform .15s ease; }
		.bg-table tr.bg-row.open .bg-caret { transform: rotate(90deg); color: var(--ii-primary); }
		.bg-caret-space { display: inline-block; width: 10px; margin-right: 7px; }
		.bg-table tr.bg-sum > td { background: var(--ii-bg-2); font-weight: 700; border-top: 1px solid var(--ii-border-2); }
		.bg-table tr.bg-sum .bg-sum-label { text-align: right; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; color: var(--ii-muted); }
		.bg-table tr.bg-sum-grand > td { background: var(--ii-soft-solid); color: var(--ii-text); border-top: 2px solid var(--ii-border-2); }
		.bg-table tr.bg-sum-grand .bg-sum-label { color: var(--ii-accent-ink); }
		.bg-table tr.bg-drill > td { background: var(--ii-bg); padding: 10px 14px; }
		.bg-subtable { width: 100%; border-collapse: collapse; font-size: 12px; }
		.bg-subtable th { text-align: left; color: var(--ii-muted); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; padding: 5px 8px; }
		.bg-subtable td { padding: 5px 8px; border-top: 1px solid var(--ii-border); }
		.bg-subtable .bg-num { text-align: right; font-variant-numeric: tabular-nums; }
		.bg-subtable .bg-rem { color: var(--ii-muted); }
		.bg-vt { color: var(--ii-faint); font-size: 10.5px; margin-left: 6px; }
		.bg-trunc { color: var(--ii-warn); font-size: 11.5px; margin-top: 8px; }
		.bg-printhead { display: none; }
		@media print {
			.ii-grid, .bg-drill, .ii-card-title { display: none !important; }
			.bg-printhead { display: block; margin-bottom: 10px; font-size: 11px; color: #000; }
			.bg-print-co { font-size: 15px; font-weight: 700; }
			.bg-table { font-size: 10px; }
			.bg-table td, .bg-table th { padding: 2px 6px; }
			.bg-table tr { page-break-inside: avoid; }
		}
	</style>`);
}
})();
