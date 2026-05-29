// Isoft Insights - Customer Balance / Receivables with aging + drill-down to invoices.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.receivables = function (ctx) {
	const st = ctx.state.receivables = ctx.state.receivables || {
		as_on: frappe.datetime.get_today(), only_overdue: 0, search: ''
	};
	const esc = isoft_insights.util.esc;

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

	const renderTable = () => {
		const term = (st.search || '').toLowerCase().trim();
		const rows = lastRows.filter((r) => !term ||
			(r.customer_name || '').toLowerCase().includes(term) ||
			(r.customer || '').toLowerCase().includes(term));

		const $body = ctx.$content.find('#ii-rec-body');
		if (!rows.length) { $body.html(isoft_insights.util.empty('No outstanding balances.')); return; }

		const body = rows.map((r) => `
			<tr class="ii-cust-row" data-customer="${esc(r.customer)}">
				<td><i class="fa fa-chevron-right ii-caret"></i><b>${esc(r.customer_name)}</b></td>
				<td class="ii-num">${ctx.number(r.invoice_count)}</td>
				<td class="ii-num">${ageCell(r.current_amt, 'ii-age-current')}</td>
				<td class="ii-num">${ageCell(r.b1_30, 'ii-age-30')}</td>
				<td class="ii-num">${ageCell(r.b31_60, 'ii-age-60')}</td>
				<td class="ii-num">${ageCell(r.b61_90, 'ii-age-90')}</td>
				<td class="ii-num">${ageCell(r.b90_plus, 'ii-age-90p')}</td>
				<td class="ii-num"><b>${ctx.money(r.total_outstanding)}</b></td>
			</tr>`).join('');

		const sum = (f) => rows.reduce((a, r) => a + flt(r[f]), 0);
		const foot = `
			<tr class="ii-totrow">
				<td>Total (${rows.length})</td>
				<td class="ii-num">${ctx.number(sum('invoice_count'))}</td>
				<td class="ii-num">${ctx.money(sum('current_amt'))}</td>
				<td class="ii-num">${ctx.money(sum('b1_30'))}</td>
				<td class="ii-num">${ctx.money(sum('b31_60'))}</td>
				<td class="ii-num">${ctx.money(sum('b61_90'))}</td>
				<td class="ii-num">${ctx.money(sum('b90_plus'))}</td>
				<td class="ii-num">${ctx.money(sum('total_outstanding'))}</td>
			</tr>`;

		$body.html(`
			<div class="ii-card-title" style="margin:8px 0 10px;"><i class="fa fa-credit-card"></i> Outstanding by customer
				<span class="ii-pill">click a row to see invoices · aged as on ${esc(st.as_on)}</span>
			</div>
			<table class="ii-table">
				<thead><tr>
					<th>Customer</th><th class="ii-num">Inv.</th>
					<th class="ii-num">Current</th><th class="ii-num">1–30</th><th class="ii-num">31–60</th>
					<th class="ii-num">61–90</th><th class="ii-num">90+</th><th class="ii-num">Total</th>
				</tr></thead>
				<tbody>${body}</tbody>
				<tfoot>${foot}</tfoot>
			</table>
		`);
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
			return `<tr>
				<td><a href="${link}" target="_blank" rel="noopener" onclick="window.open('${link}','_blank');return false;">${esc(iv.invoice)}</a></td>
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

	// Delegate clicks (tbody is re-rendered on search, container is stable)
	ctx.$content.on('click', '.ii-cust-row', function () {
		const $row = $(this);
		const $next = $row.next('.ii-detail-row');
		if ($next.length) { $next.remove(); $row.removeClass('open'); return; }
		ctx.$content.find('.ii-detail-row').remove();
		ctx.$content.find('.ii-cust-row').removeClass('open');
		$row.addClass('open');
		const customer = $row.data('customer');
		const $detail = $(`<tr class="ii-detail-row"><td colspan="8"><div class="ii-loading" style="padding:18px"><i class="fa fa-spinner fa-spin"></i> Loading invoices…</div></td></tr>`);
		$row.after($detail);
		ctx.api('get_customer_open_invoices', { customer: customer, as_on_date: st.as_on || null, company: ctx.app.filters().company })
			.then((data) => $detail.find('td').html(detailHtml(data)))
			.catch(() => $detail.find('td').html('<div style="color:var(--ii-muted)">Could not load invoices.</div>'));
	});

	const load = () => {
		ctx.$content.find('#ii-rec-body').html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_customer_balance', {
			as_on_date: st.as_on || null, only_overdue: st.only_overdue ? 1 : 0, company: ctx.app.filters().company
		}).then((data) => {
			lastRows = (data && data.rows) || [];
			renderKpis((data && data.totals) || {});
			renderTable();
		}).catch(() => ctx.$content.find('#ii-rec-body').html(isoft_insights.util.empty('Could not load receivables.')));
	};

	ctx.$content.find('#r-ason').on('change', function () { st.as_on = $(this).val(); load(); });
	ctx.$content.find('#r-overdue').on('change', function () { st.only_overdue = $(this).prop('checked') ? 1 : 0; load(); });
	ctx.$content.find('#r-search').on('input', function () { st.search = $(this).val(); renderTable(); });

	load();
};
