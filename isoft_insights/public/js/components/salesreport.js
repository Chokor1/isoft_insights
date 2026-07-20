(function () {
'use strict';
// Isoft Insights - Sales activity report.
// Group by Transaction (expand -> items) or by Item (expand -> transactions).
// Filters: date range, branch, customer, customer group.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.salesreport = function (ctx) {
	const esc = isoft_insights.util.esc;
	const st = ctx.state.salesreport = ctx.state.salesreport || {
		from: startOfYear(), to: frappe.datetime.get_today(),
		branch: '', customer: '', customer_group: '', group_by: 'transaction',
		search: '', colf: {}, sort: { col: null, dir: 'desc' }
	};
	st.colf = st.colf || {};
	st.sort = st.sort || { col: null, dir: 'desc' };
	injectStyles();

	// ---- column definitions per mode ----
	const MODES = {
		transaction: {
			keyOf: (r) => r.invoice,
			searchOf: (r) => ((r.invoice || '') + ' ' + (r.customer_name || '')).toLowerCase(),
			cols: [
				{ id: 'invoice', label: 'Invoice', type: 'text', get: (r) => r.invoice || '' },
				{ id: 'posting_date', label: 'Date', type: 'text', get: (r) => r.posting_date || '' },
				{ id: 'customer_name', label: 'Customer', type: 'text', get: (r) => r.customer_name || '' },
				{ id: 'customer_group', label: 'Group', type: 'text', get: (r) => r.customer_group || '' },
				{ id: 'branch', label: 'Branch', type: 'text', get: (r) => r.branch || '' },
				{ id: 'qty', label: 'Qty', type: 'num', get: (r) => flt(r.qty) },
				{ id: 'net_amount', label: 'Net Amount', type: 'money', get: (r) => flt(r.net_amount) },
				{ id: 'grand_total', label: 'Grand Total', type: 'money', get: (r) => flt(r.grand_total) }
			]
		},
		item: {
			keyOf: (r) => r.item_code,
			searchOf: (r) => ((r.item_code || '') + ' ' + (r.item_name || '')).toLowerCase(),
			cols: [
				{ id: 'item_code', label: 'Item', type: 'text', get: (r) => r.item_code || '' },
				{ id: 'item_name', label: 'Description', type: 'text', get: (r) => r.item_name || '' },
				{ id: 'item_group', label: 'Item Group', type: 'text', get: (r) => r.item_group || '' },
				{
					id: 'last_date', label: 'Date', type: 'text',
					get: (r) => r.last_date || '',
					// Last sale date; if the item sold on several dates, the full range is on hover.
					render: (r) => {
						const f = r.first_date, l = r.last_date;
						if (!l) return '';
						if (!f || String(f) === String(l)) return esc(l);
						return `<span title="${esc(f)} → ${esc(l)}">${esc(l)} <span class="sr-more">…</span></span>`;
					}
				},
				{
					id: 'customers', label: 'Customer', type: 'text',
					get: (r) => r.customers || '',
					// One customer -> show the name; several -> first name + "+N" (full list on hover).
					render: (r) => {
						const names = String(r.customers || '').split(', ').filter(Boolean);
						const n = cint(r.customer_count);
						if (!names.length) return '';
						if (n <= 1) return esc(names[0]);
						return `<span title="${esc(r.customers)}">${esc(names[0])} <span class="sr-more">+${n - 1}</span></span>`;
					}
				},
				{ id: 'invoice_count', label: 'Invoices', type: 'num', get: (r) => flt(r.invoice_count) },
				{ id: 'qty', label: 'Qty', type: 'num', get: (r) => flt(r.qty) },
				{ id: 'net_amount', label: 'Net Amount', type: 'money', get: (r) => flt(r.net_amount) }
			]
		}
	};
	// When filtering by a single customer the customer column is the same on every
	// row, so drop it (By Item -> "customers", By Transaction -> "customer_name").
	const mode = () => {
		const m = MODES[st.group_by] || MODES.transaction;
		if (!st.customer) return m;
		const hide = st.group_by === 'item' ? 'customers' : 'customer_name';
		return Object.assign({}, m, { cols: m.cols.filter((c) => c.id !== hide) });
	};

	let lastRows = [];

	// Display name of the customer currently filtered on (falls back to its code).
	const custLabel = () => {
		if (!st.customer) return '';
		const r = lastRows[0];
		if (!r) return st.customer;
		if (st.group_by === 'item') return String(r.customers || '').split(', ')[0] || st.customer;
		return r.customer_name || st.customer;
	};

	// ---- shell ----
	ctx.$content.html(`
		<div class="ii-card">
			<div class="ii-rowfilters">
				<label>From</label><input type="date" class="form-control ii-input" id="sr-from" value="${esc(st.from)}">
				<label>To</label><input type="date" class="form-control ii-input" id="sr-to" value="${esc(st.to)}">
				<label>Branch</label><select class="form-control ii-input" id="sr-branch"></select>
				<label>Cust. Group</label><select class="form-control ii-input" id="sr-cgroup"></select>
				<span class="sr-link-wrap" id="sr-customer-wrap"></span>
				<label>View</label>
				<select class="form-control ii-input" id="sr-groupby">
					<option value="transaction" ${st.group_by === 'transaction' ? 'selected' : ''}>By Transaction</option>
					<option value="item" ${st.group_by === 'item' ? 'selected' : ''}>By Item</option>
				</select>
				<button class="btn btn-default ii-refresh" id="sr-reload" title="Refresh"><i class="fa fa-refresh"></i></button>
				<button class="btn btn-default ii-refresh" id="sr-xlsx" title="Export to Excel"><i class="fa fa-file-excel-o"></i></button>
				<button class="btn btn-default ii-refresh" id="sr-print" title="Print / Save as PDF"><i class="fa fa-print"></i></button>
				<input type="text" class="form-control ii-input ii-search" id="sr-search" placeholder="Search…" value="${esc(st.search)}" style="margin-left:auto;">
			</div>
			<div id="ii-sr-kpis"></div>
			<div id="ii-sr-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
		</div>
	`);

	// Customer link picker (searchable)
	const custCtl = frappe.ui.form.make_control({
		df: {
			fieldtype: 'Link', options: 'Customer', fieldname: 'sr_customer',
			placeholder: 'Customer…', only_select: true,
			onchange: () => { st.customer = custCtl.get_value() || ''; load(); }
		},
		parent: ctx.$content.find('#sr-customer-wrap'),
		render_input: true
	});
	custCtl.$input.addClass('ii-input').attr('placeholder', 'Customer…');
	if (st.customer) custCtl.set_value(st.customer);

	const fillSelect = (sel, values, current, allLabel) => {
		const opts = [`<option value="">${allLabel}</option>`].concat(
			(values || []).map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`)
		);
		ctx.$content.find(sel).html(opts.join(''));
	};
	ctx.api('get_sales_branches').then((b) => fillSelect('#sr-branch', b, st.branch, 'All Branches')).catch(() => {});
	ctx.api('get_customer_groups').then((g) => fillSelect('#sr-cgroup', g, st.customer_group, 'All Groups')).catch(() => {});

	// ---- KPIs ----
	const renderKpis = (t, currency) => {
		const isTxn = st.group_by === 'transaction';
		ctx.$content.find('#ii-sr-kpis').html(`
			<div class="ii-grid" style="margin-bottom:8px;">
				<div class="ii-kpi"><div class="ii-kpi-label">Net Sales (excl. tax)</div><div class="ii-kpi-value">${ctx.money(t.net_amount)}</div></div>
				${isTxn ? `<div class="ii-kpi"><div class="ii-kpi-label">Grand Total (incl. tax)</div><div class="ii-kpi-value">${ctx.money(t.grand_total)}</div></div>` : ''}
				<div class="ii-kpi"><div class="ii-kpi-label">Quantity</div><div class="ii-kpi-value">${ctx.number(t.qty)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">${isTxn ? 'Transactions' : 'Items'}</div><div class="ii-kpi-value">${ctx.number(t.count)}</div></div>
			</div>
		`);
	};

	// ---- filtering / sorting ----
	const numPred = (raw) => {
		const s = (raw || '').trim();
		if (!s) return null;
		const num = (x) => flt(String(x).replace(/[, ]/g, ''));
		let m = s.match(/^(>=|<=|>|<|=)?\s*(-?[\d.,]+)$/);
		if (m) {
			const op = m[1] || '=', n = num(m[2]);
			return (v) => op === '>' ? v > n : op === '<' ? v < n
				: op === '>=' ? v >= n : op === '<=' ? v <= n : Math.abs(v - n) < 0.005;
		}
		m = s.match(/^(-?[\d.,]+)\s*-\s*(-?[\d.,]+)$/);
		if (m) { const a = num(m[1]), b = num(m[2]); return (v) => v >= a && v <= b; }
		return null;
	};

	const filteredRows = () => {
		const m = mode();
		const term = (st.search || '').toLowerCase().trim();
		const preds = m.cols.map((c) => {
			const raw = st.colf[c.id];
			if (!raw) return null;
			if (c.type === 'text') {
				const t = String(raw).toLowerCase();
				return (r) => String(c.get(r)).toLowerCase().includes(t);
			}
			const p = numPred(raw);
			return p ? (r) => p(c.get(r)) : null;
		}).filter(Boolean);

		const out = lastRows.filter((r) => (!term || m.searchOf(r).includes(term)) && preds.every((p) => p(r)));
		const col = st.sort.col && m.cols.find((c) => c.id === st.sort.col);
		if (col) {
			const dir = st.sort.dir === 'asc' ? 1 : -1;
			out.sort((a, b) => {
				let va = col.get(a), vb = col.get(b);
				if (col.type === 'text') { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
				if (va < vb) return -dir;
				if (va > vb) return dir;
				return 0;
			});
		}
		return out;
	};

	const cellHtml = (c, r) => {
		if (c.render) return `<td>${c.render(r)}</td>`;
		const v = c.get(r);
		if (c.type === 'money') return `<td class="ii-num">${ctx.money(v)}</td>`;
		if (c.type === 'num') return `<td class="ii-num">${ctx.number(v)}</td>`;
		return `<td>${esc(v)}</td>`;
	};

	const paint = () => {
		const m = mode();
		const rows = filteredRows();
		const $tb = ctx.$content.find('#ii-sr-tbody');
		const $tf = ctx.$content.find('#ii-sr-tfoot');
		if (!rows.length) {
			$tb.html(`<tr><td colspan="${m.cols.length}">${isoft_insights.util.empty('No rows match the filters.')}</td></tr>`);
			$tf.empty();
			return;
		}
		$tb.html(rows.map((r) => {
			const cells = m.cols.map((c, i) => {
				if (i === 0) return `<td><i class="fa fa-chevron-right ii-caret"></i><b>${esc(c.get(r))}</b></td>`;
				return cellHtml(c, r);
			}).join('');
			return `<tr class="ii-sr-row" data-key="${esc(m.keyOf(r))}">${cells}</tr>`;
		}).join(''));

		const sum = (id) => rows.reduce((a, r) => a + flt(m.cols.find((c) => c.id === id).get(r)), 0);
		const foot = m.cols.map((c, i) => {
			if (i === 0) return `<td>Total (${rows.length})</td>`;
			if (c.type === 'money') return `<td class="ii-num">${ctx.money(sum(c.id))}</td>`;
			if (c.type === 'num') return `<td class="ii-num">${ctx.number(sum(c.id))}</td>`;
			return '<td></td>';
		}).join('');
		$tf.html(`<tr class="ii-totrow">${foot}</tr>`);
	};

	const updateSortIndicators = () => {
		ctx.$content.find('.ii-sortable').each(function () {
			const col = $(this).data('sort');
			const active = st.sort.col === col;
			$(this).toggleClass('sorted', active);
			$(this).find('.ii-sort-ind').text(active ? (st.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
		});
	};

	const renderTable = () => {
		const m = mode();
		const head = m.cols.map((c) => {
			const numCls = (c.type === 'text') ? '' : 'ii-num ';
			return `<th class="${numCls}ii-sortable" data-sort="${c.id}">${esc(c.label)}<span class="ii-sort-ind"></span></th>`;
		}).join('');
		const filters = m.cols.map((c) =>
			`<td><input type="text" class="ii-colf form-control" data-col="${c.id}" value="${esc(st.colf[c.id] || '')}" placeholder="${c.type === 'text' ? '…' : '> <'}"></td>`
		).join('');

		const custTag = st.customer ? `<span class="sr-ctx"><i class="fa fa-user"></i> ${esc(custLabel())}</span>` : '';
		ctx.$content.find('#ii-sr-body').html(`
			<div class="ii-card-title" style="margin:8px 0 10px;"><i class="fa fa-shopping-cart"></i>
				${st.group_by === 'item' ? 'Sales by item' : 'Sales by transaction'} ${custTag}
				<span class="ii-pill">click a row to expand ${st.group_by === 'item' ? 'transactions' : 'items'} · filter row supports &gt; &lt; &gt;= &lt;= and 100-200</span>
			</div>
			<table class="ii-table">
				<thead><tr>${head}</tr><tr class="ii-filterrow">${filters}</tr></thead>
				<tbody id="ii-sr-tbody"></tbody>
				<tfoot id="ii-sr-tfoot"></tfoot>
			</table>
		`);
		updateSortIndicators();
		paint();
	};

	// ---- drill-down ----
	const detailHtml = (data) => {
		const rows = (data && data.rows) || [];
		if (!rows.length) return '<div style="color:var(--ii-muted);font-size:12px;">No detail.</div>';
		if (st.group_by === 'item') {
			const lines = rows.map((d) => `
				<tr class="ii-inv-row" data-href="/app/sales-invoice/${encodeURIComponent(d.invoice)}" style="cursor:pointer;">
					<td><a href="/app/sales-invoice/${encodeURIComponent(d.invoice)}" target="_blank" rel="noopener">${esc(d.invoice)}</a></td>
					<td>${esc(d.posting_date || '')}</td>
					<td>${esc(d.customer_name || '')}</td>
					<td>${esc(d.branch || '')}</td>
					<td class="ii-num">${ctx.number(d.qty)}</td>
					<td class="ii-num">${ctx.money(d.rate)}</td>
					<td class="ii-num">${ctx.money(d.net_amount)}</td>
				</tr>`).join('');
			return `<table class="ii-subtable">
				<thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Branch</th>
					<th class="ii-num">Qty</th><th class="ii-num">Rate</th><th class="ii-num">Net Amount</th></tr></thead>
				<tbody>${lines}</tbody></table>`;
		}
		const lines = rows.map((d) => `
			<tr>
				<td>${esc(d.item_code)}</td>
				<td>${esc(d.item_name || '')}</td>
				<td>${esc(d.item_group || '')}</td>
				<td>${esc(d.warehouse || '')}</td>
				<td class="ii-num">${ctx.number(d.qty)}</td>
				<td class="ii-num">${ctx.money(d.rate)}</td>
				<td class="ii-num">${ctx.money(d.net_amount)}</td>
			</tr>`).join('');
		return `<table class="ii-subtable">
			<thead><tr><th>Item</th><th>Description</th><th>Item Group</th><th>Warehouse</th>
				<th class="ii-num">Qty</th><th class="ii-num">Rate</th><th class="ii-num">Net Amount</th></tr></thead>
			<tbody>${lines}</tbody></table>`;
	};

	ctx.$content.off('click', '.ii-inv-row').on('click', '.ii-inv-row', function (e) {
		if ($(e.target).closest('a').length) return;
		const href = $(this).data('href');
		if (href) window.open(href, '_blank', 'noopener');
	});

	ctx.$content.off('click', '.ii-sr-row').on('click', '.ii-sr-row', function () {
		const $row = $(this);
		const m = mode();
		const $next = $row.next('.ii-detail-row');
		if ($next.length) { $next.remove(); $row.removeClass('open'); return; }
		ctx.$content.find('.ii-detail-row').remove();
		ctx.$content.find('.ii-sr-row').removeClass('open');
		$row.addClass('open');
		const $detail = $(`<tr class="ii-detail-row"><td colspan="${m.cols.length}"><div class="ii-loading" style="padding:18px"><i class="fa fa-spinner fa-spin"></i> Loading…</div></td></tr>`);
		$row.after($detail);
		ctx.api('get_sales_activity_detail', {
			group_by: st.group_by, key: $row.data('key'),
			from_date: st.from || null, to_date: st.to || null,
			company: ctx.app.filters().company, branch: st.branch || null,
			customer: st.customer || null, customer_group: st.customer_group || null
		}).then((data) => $detail.find('td').html(detailHtml(data)))
			.catch(() => $detail.find('td').html('<div style="color:var(--ii-muted)">Could not load detail.</div>'));
	});

	ctx.$content.off('click', '.ii-sortable').on('click', '.ii-sortable', function () {
		const col = $(this).data('sort');
		const m = mode();
		const def = m.cols.find((c) => c.id === col);
		if (st.sort.col === col) st.sort.dir = st.sort.dir === 'asc' ? 'desc' : 'asc';
		else { st.sort.col = col; st.sort.dir = (def && def.type === 'text') ? 'asc' : 'desc'; }
		updateSortIndicators();
		paint();
	});

	ctx.$content.off('input', '.ii-colf').on('input', '.ii-colf', function () {
		st.colf[$(this).data('col')] = $(this).val();
		paint();
	});

	// ---- load ----
	function load() {
		ctx.$content.find('#ii-sr-body').html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_sales_activity', {
			from_date: st.from || null, to_date: st.to || null,
			company: ctx.app.filters().company, branch: st.branch || null,
			customer: st.customer || null, customer_group: st.customer_group || null,
			group_by: st.group_by
		}).then((data) => {
			lastRows = (data && data.rows) || [];
			renderKpis((data && data.totals) || {}, data && data.currency);
			renderTable();
		}).catch(() => ctx.$content.find('#ii-sr-body').html(isoft_insights.util.empty('Could not load sales.')));
	}

	ctx.$content.find('#sr-from').on('change', function () { st.from = $(this).val(); load(); });
	ctx.$content.find('#sr-to').on('change', function () { st.to = $(this).val(); load(); });
	ctx.$content.find('#sr-branch').on('change', function () { st.branch = $(this).val(); load(); });
	ctx.$content.find('#sr-cgroup').on('change', function () { st.customer_group = $(this).val(); load(); });
	ctx.$content.find('#sr-groupby').on('change', function () {
		st.group_by = $(this).val(); st.colf = {}; st.sort = { col: null, dir: 'desc' }; load();
	});
	ctx.$content.find('#sr-reload').on('click', load);
	ctx.$content.find('#sr-search').on('input', function () { st.search = $(this).val(); paint(); });

	// ---- export / print (uses the rows currently displayed, i.e. filtered + sorted) ----
	const reportTitle = () => (st.group_by === 'item' ? 'Sales by Item' : 'Sales by Transaction');
	const metaLines = () => {
		const l = [`Período: ${st.from || '—'} → ${st.to || '—'}`];
		if (st.branch) l.push(`Branch: ${st.branch}`);
		if (st.customer_group) l.push(`Customer Group: ${st.customer_group}`);
		if (st.customer) l.push(`Customer: ${custLabel()}`);
		return l;
	};

	ctx.$content.find('#sr-xlsx').on('click', function () {
		const m = mode();
		const rows = filteredRows();
		// Numbers exported as real numbers so Excel can total them.
		const data = rows.map((r) => m.cols.map((c) => {
			const v = c.get(r);
			return (c.type === 'money' || c.type === 'num') ? flt(v) : String(v == null ? '' : v);
		}));
		isoft_insights.exportXlsx(reportTitle(), m.cols.map((c) => c.label), data);
	});

	ctx.$content.find('#sr-print').on('click', function () {
		const m = mode();
		const rows = filteredRows();
		const data = rows.map((r) => m.cols.map((c) => {
			const v = c.get(r);
			if (c.type === 'money') return ctx.money(v);
			if (c.type === 'num') return ctx.number(v);
			return v == null ? '' : String(v);
		}));
		// Totals row
		const totals = m.cols.map((c, i) => {
			if (i === 0) return `Total (${rows.length})`;
			if (c.type === 'money') return ctx.money(rows.reduce((a, r) => a + flt(c.get(r)), 0));
			if (c.type === 'num') return ctx.number(rows.reduce((a, r) => a + flt(c.get(r)), 0));
			return '';
		});
		data.push(totals);
		isoft_insights.printTable({
			title: reportTitle(),
			company: (ctx.app.state.company || 'All Companies'),
			meta: metaLines(),
			columns: m.cols.map((c) => ({ label: c.label, num: c.type !== 'text' })),
			rows: data,
			landscape: true
		});
	});

	load();
};

function startOfYear() {
	const d = frappe.datetime.str_to_obj(frappe.datetime.get_today());
	return frappe.datetime.obj_to_str(new Date(d.getFullYear(), 0, 1));
}

function injectStyles() {
	if (document.getElementById('ii-sr-styles')) return;
	$('head').append(`<style id="ii-sr-styles">
		.ii-table th.ii-sortable { cursor: pointer; user-select: none; white-space: nowrap; }
		.ii-table th.ii-sortable:hover { color: var(--ii-primary); }
		.ii-table th.ii-sortable.sorted { color: var(--ii-primary); }
		.ii-table th .ii-sort-ind { font-size: 10px; }
		.ii-sr-row { cursor: pointer; }
		.ii-sr-row .ii-caret { transition: transform .2s; color: var(--ii-muted); margin-right: 7px; font-size: 11px; }
		.ii-sr-row.open .ii-caret { transform: rotate(90deg); color: var(--ii-primary); }
		.ii-sr-row.open > td { background: #eef2ff; }
		[data-theme="dark"] .ii-sr-row.open > td { background: rgba(59,130,246,0.16); }
		.sr-link-wrap { display: inline-block; min-width: 160px; }
		.sr-link-wrap .form-group { margin-bottom: 0 !important; }
		.sr-link-wrap .control-label, .sr-link-wrap .help-box { display: none !important; }
		.sr-link-wrap input { height: 32px; border: 1px solid var(--ii-border) !important; border-radius: 9px !important; }
		.sr-more { display: inline-block; margin-left: 4px; padding: 1px 6px; border-radius: 20px; font-size: 11px;
			font-weight: 700; background: var(--ii-bg); color: var(--ii-muted); border: 1px solid var(--ii-border); cursor: help; }
		.sr-ctx { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; padding: 2px 9px; border-radius: 20px;
			font-size: 12px; font-weight: 600; background: var(--ii-primary); color: #fff; }
	</style>`);
}
})();
