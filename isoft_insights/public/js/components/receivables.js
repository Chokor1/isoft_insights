// Isoft Insights - Customer Balance / Receivables with aging + drill-down to invoices.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.receivables = function (ctx) {
	const st = ctx.state.receivables = ctx.state.receivables || {
		as_on: frappe.datetime.get_today(), only_overdue: 0, search: '', colf: {}
	};
	st.colf = st.colf || {};
	st.sort = st.sort || { col: null, dir: 'desc' };
	const esc = isoft_insights.util.esc;
	injectSortStyles();

	ctx.$content.html(`
		<div class="ii-card">
			<div class="ii-rowfilters">
				<label>As on</label>
				<input type="date" class="form-control ii-input" id="r-ason" value="${esc(st.as_on)}">
				<label style="margin-left:10px;"><input type="checkbox" id="r-overdue" ${st.only_overdue ? 'checked' : ''}> Only overdue</label>
				<input type="text" class="form-control ii-input ii-search" id="r-search" placeholder="Search customer…" value="${esc(st.search)}" style="margin-left:auto;">
			</div>
			<div id="ii-rec-kpis"></div>
			<div id="ii-rec-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
		</div>
	`);

	let lastRows = [];

	const renderKpis = (totals) => {
		ctx.$content.find('#ii-rec-kpis').html(`
			<div class="ii-grid" style="margin-bottom:8px;">
				<div class="ii-kpi"><div class="ii-kpi-label">Total Outstanding</div><div class="ii-kpi-value">${ctx.money(totals.total_outstanding)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">Current</div><div class="ii-kpi-value" style="color:#166534">${ctx.money(totals.current_amt)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">1–30 days</div><div class="ii-kpi-value" style="color:#854d0e">${ctx.money(totals.b1_30)}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">31–90 days</div><div class="ii-kpi-value" style="color:#9a3412">${ctx.money(flt(totals.b31_60) + flt(totals.b61_90))}</div></div>
				<div class="ii-kpi"><div class="ii-kpi-label">90+ days</div><div class="ii-kpi-value" style="color:#991b1b">${ctx.money(totals.b90_plus)}</div></div>
			</div>
		`);
	};

	const ageCell = (val, cls) => val ? `<span class="ii-aging-badge ${cls}">${ctx.money(val)}</span>` : '<span class="ii-zero">·</span>';

	// Per-column value getters (numeric columns are filterable with operators).
	const overdueOf = (r) => flt(r.total_outstanding) - flt(r.current_amt);
	const NUMCOLS = [
		{ id: 'invoice_count', get: (r) => flt(r.invoice_count) },
		{ id: 'current_amt', get: (r) => flt(r.current_amt) },
		{ id: 'b1_30', get: (r) => flt(r.b1_30) },
		{ id: 'b31_60', get: (r) => flt(r.b31_60) },
		{ id: 'b61_90', get: (r) => flt(r.b61_90) },
		{ id: 'b90_plus', get: (r) => flt(r.b90_plus) },
		{ id: 'total_outstanding', get: (r) => flt(r.total_outstanding) },
		{ id: 'overdue', get: overdueOf },
		{ id: 'balance', get: (r) => flt(r.balance) },
	];

	// Sort value getters: numeric columns reuse NUMCOLS; customer sorts by name.
	const sortGetters = { customer: (r) => (r.customer_name || r.customer || '').toLowerCase() };
	NUMCOLS.forEach((c) => { sortGetters[c.id] = c.get; });

	// Parse a numeric filter like ">1000", "<= 50", "=0", "100-200" into a predicate.
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
		const term = (st.search || '').toLowerCase().trim();
		const cf = (st.colf.customer || '').toLowerCase().trim();
		const preds = NUMCOLS
			.map((c) => ({ get: c.get, p: numPred(st.colf[c.id]) }))
			.filter((c) => c.p);
		const matchCust = (r) => {
			const name = (r.customer_name || '').toLowerCase(), code = (r.customer || '').toLowerCase();
			return (!term || name.includes(term) || code.includes(term)) &&
				(!cf || name.includes(cf) || code.includes(cf));
		};
		const out = lastRows.filter((r) => matchCust(r) && preds.every((c) => c.p(c.get(r))));
		const g = st.sort.col && sortGetters[st.sort.col];
		if (g) {
			const dir = st.sort.dir === 'asc' ? 1 : -1;
			out.sort((a, b) => {
				const va = g(a), vb = g(b);
				if (va < vb) return -dir;
				if (va > vb) return dir;
				return 0;
			});
		}
		return out;
	};

	const fInput = (id, ph) => `<input type="text" class="ii-colf form-control" data-col="${id}" value="${esc(st.colf[id] || '')}" placeholder="${ph}">`;

	// Repaint only tbody + tfoot so the header filter inputs keep focus while typing.
	const paint = () => {
		const rows = filteredRows();
		const $tb = ctx.$content.find('#ii-rec-tbody');
		const $tf = ctx.$content.find('#ii-rec-tfoot');
		if (!rows.length) {
			$tb.html(`<tr><td colspan="10">${isoft_insights.util.empty('No rows match the filters.')}</td></tr>`);
			$tf.empty();
			return;
		}
		$tb.html(rows.map((r) => `
			<tr class="ii-cust-row" data-customer="${esc(r.customer)}">
				<td><i class="fa fa-chevron-right ii-caret"></i><b>${esc(r.customer_name)}</b></td>
				<td class="ii-num">${ctx.number(r.invoice_count)}</td>
				<td class="ii-num">${ageCell(r.current_amt, 'ii-age-current')}</td>
				<td class="ii-num">${ageCell(r.b1_30, 'ii-age-30')}</td>
				<td class="ii-num">${ageCell(r.b31_60, 'ii-age-60')}</td>
				<td class="ii-num">${ageCell(r.b61_90, 'ii-age-90')}</td>
				<td class="ii-num">${ageCell(r.b90_plus, 'ii-age-90p')}</td>
				<td class="ii-num"><b>${ctx.money(r.total_outstanding)}</b></td>
				<td class="ii-num">${ctx.money(overdueOf(r))}</td>
				<td class="ii-num"><b>${ctx.money(r.balance)}</b></td>
			</tr>`).join(''));

		const sum = (f) => rows.reduce((a, r) => a + flt(r[f]), 0);
		$tf.html(`
			<tr class="ii-totrow">
				<td>Total (${rows.length})</td>
				<td class="ii-num">${ctx.number(sum('invoice_count'))}</td>
				<td class="ii-num">${ctx.money(sum('current_amt'))}</td>
				<td class="ii-num">${ctx.money(sum('b1_30'))}</td>
				<td class="ii-num">${ctx.money(sum('b31_60'))}</td>
				<td class="ii-num">${ctx.money(sum('b61_90'))}</td>
				<td class="ii-num">${ctx.money(sum('b90_plus'))}</td>
				<td class="ii-num">${ctx.money(sum('total_outstanding'))}</td>
				<td class="ii-num">${ctx.money(sum('total_outstanding') - sum('current_amt'))}</td>
				<td class="ii-num">${ctx.money(sum('balance'))}</td>
			</tr>`);
	};

	// Reflect the active sort column/direction in the header arrows.
	const updateSortIndicators = () => {
		ctx.$content.find('.ii-sortable').each(function () {
			const col = $(this).data('sort');
			const active = st.sort.col === col;
			$(this).toggleClass('sorted', active);
			$(this).find('.ii-sort-ind').text(active ? (st.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
		});
	};

	// Build the static table shell (title + header + filter row); rows via paint().
	const renderTable = () => {
		ctx.$content.find('#ii-rec-body').html(`
			<div class="ii-card-title" style="margin:8px 0 10px;"><i class="fa fa-credit-card"></i> Outstanding by customer
				<span class="ii-pill">click a row to see invoices · filter row supports &gt; &lt; &gt;= &lt;= and 100-200 · aged as on ${esc(st.as_on)}</span>
			</div>
			<table class="ii-table">
				<thead>
					<tr>
						<th class="ii-sortable" data-sort="customer">Customer<span class="ii-sort-ind"></span></th><th class="ii-num ii-sortable" data-sort="invoice_count">Inv.<span class="ii-sort-ind"></span></th>
						<th class="ii-num ii-sortable" data-sort="current_amt">Current<span class="ii-sort-ind"></span></th><th class="ii-num ii-sortable" data-sort="b1_30">1–30<span class="ii-sort-ind"></span></th><th class="ii-num ii-sortable" data-sort="b31_60">31–60<span class="ii-sort-ind"></span></th>
						<th class="ii-num ii-sortable" data-sort="b61_90">61–90<span class="ii-sort-ind"></span></th><th class="ii-num ii-sortable" data-sort="b90_plus">90+<span class="ii-sort-ind"></span></th><th class="ii-num ii-sortable" data-sort="total_outstanding">Total Outstanding<span class="ii-sort-ind"></span></th>
						<th class="ii-num ii-sortable" data-sort="overdue">Total Overdue<span class="ii-sort-ind"></span></th>
						<th class="ii-num ii-sortable" data-sort="balance">Balance<span class="ii-sort-ind"></span></th>
					</tr>
					<tr class="ii-filterrow">
						<td>${fInput('customer', 'Customer…')}</td>
						<td>${fInput('invoice_count', '> 0')}</td>
						<td>${fInput('current_amt', '> <')}</td>
						<td>${fInput('b1_30', '> <')}</td>
						<td>${fInput('b31_60', '> <')}</td>
						<td>${fInput('b61_90', '> <')}</td>
						<td>${fInput('b90_plus', '> <')}</td>
						<td>${fInput('total_outstanding', '> <')}</td>
						<td>${fInput('overdue', '> <')}</td>
						<td>${fInput('balance', '> <')}</td>
					</tr>
				</thead>
				<tbody id="ii-rec-tbody"></tbody>
				<tfoot id="ii-rec-tfoot"></tfoot>
			</table>
		`);
		paint();
	};

	// Drill-down: expand a customer row to show their open invoices
	const detailHtml = (data) => {
		const rows = (data && data.rows) || [];
		if (!rows.length) return '<div style="color:var(--ii-muted);font-size:12px;">No open invoices.</div>';
		const lines = rows.map((iv) => {
			const overdue = flt(iv.days_overdue) > 0
				? `<span class="ii-overdue">${cint(iv.days_overdue)} days</span>`
				: '<span class="ii-notdue">Not due</span>';
			const link = `/app/sales-invoice/${encodeURIComponent(iv.invoice)}`;
			return `<tr class="ii-inv-row" data-href="${link}" style="cursor:pointer;">
				<td><a href="${link}" target="_blank" rel="noopener">${esc(iv.invoice)}</a></td>
				<td>${esc(iv.posting_date || '')}</td>
				<td>${esc(iv.due_date || '—')}</td>
				<td>${overdue}</td>
				<td class="ii-num">${esc(iv.status || '')}</td>
				<td class="ii-num">${ctx.money(iv.outstanding)}</td>
			</tr>`;
		}).join('');
		return `<table class="ii-subtable">
			<thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Overdue</th><th class="ii-num">Status</th><th class="ii-num">Outstanding</th></tr></thead>
			<tbody>${lines}</tbody></table>`;
	};

	// Click anywhere on an invoice row to open that Sales Invoice in a new tab.
	// (Skip when the inner <a> handles the click itself.)
	ctx.$content.on('click', '.ii-inv-row', function (e) {
		if ($(e.target).closest('a').length) return;
		const href = $(this).data('href');
		if (href) window.open(href, '_blank', 'noopener');
	});

	// Delegate clicks (tbody is re-rendered on search, container is stable)
	ctx.$content.on('click', '.ii-cust-row', function () {
		const $row = $(this);
		const $next = $row.next('.ii-detail-row');
		if ($next.length) { $next.remove(); $row.removeClass('open'); return; }
		ctx.$content.find('.ii-detail-row').remove();
		ctx.$content.find('.ii-cust-row').removeClass('open');
		$row.addClass('open');
		const customer = $row.data('customer');
		const $detail = $(`<tr class="ii-detail-row"><td colspan="10"><div class="ii-loading" style="padding:18px"><i class="fa fa-spinner fa-spin"></i> Loading invoices…</div></td></tr>`);
		$row.after($detail);
		ctx.api('get_customer_open_invoices', { customer: customer, as_on_date: st.as_on || null, company: ctx.app.filters().company })
			.then((data) => $detail.find('td').html(detailHtml(data)))
			.catch(() => $detail.find('td').html('<div style="color:var(--ii-muted)">Could not load invoices.</div>'));
	});

	// Click a column header to sort (toggle asc/desc; numeric defaults to desc, text to asc).
	ctx.$content.off('click', '.ii-sortable').on('click', '.ii-sortable', function () {
		const col = $(this).data('sort');
		if (st.sort.col === col) {
			st.sort.dir = st.sort.dir === 'asc' ? 'desc' : 'asc';
		} else {
			st.sort.col = col;
			st.sort.dir = (col === 'customer') ? 'asc' : 'desc';
		}
		updateSortIndicators();
		paint();
	});

	function injectSortStyles() {
		if (document.getElementById('ii-rec-sort-styles')) return;
		$('head').append(`<style id="ii-rec-sort-styles">
			.ii-table th.ii-sortable { cursor: pointer; user-select: none; white-space: nowrap; }
			.ii-table th.ii-sortable:hover { color: var(--ii-primary); }
			.ii-table th.ii-sortable.sorted { color: var(--ii-primary); }
			.ii-table th .ii-sort-ind { font-size: 10px; }
		</style>`);
	}

	const load = () => {
		ctx.$content.find('#ii-rec-body').html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_customer_balance', {
			as_on_date: st.as_on || null, only_overdue: st.only_overdue ? 1 : 0, company: ctx.app.filters().company
		}).then((data) => {
			lastRows = (data && data.rows) || [];
			renderKpis((data && data.totals) || {});
			renderTable();
			updateSortIndicators();
		}).catch(() => ctx.$content.find('#ii-rec-body').html(isoft_insights.util.empty('Could not load receivables.')));
	};

	ctx.$content.find('#r-ason').on('change', function () { st.as_on = $(this).val(); load(); });
	ctx.$content.find('#r-overdue').on('change', function () { st.only_overdue = $(this).prop('checked') ? 1 : 0; load(); });
	ctx.$content.find('#r-search').on('input', function () { st.search = $(this).val(); paint(); });

	// Per-column filter inputs in the table header (text for customer, operators for amounts).
	ctx.$content.off('input', '.ii-colf').on('input', '.ii-colf', function () {
		st.colf[$(this).data('col')] = $(this).val();
		paint();
	});

	load();
};
