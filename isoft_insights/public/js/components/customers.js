// Isoft Insights - Sales by customer with dynamic filters (top N + search).
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data for this period.'}</div>`,
	bar: (val, max) => {
		const pct = max ? Math.max(2, (flt(val) / max) * 100) : 0;
		return `<div class="ii-bar-track"><div class="ii-bar-fill" style="width:${pct}%"></div></div>`;
	}
};

isoft_insights.views.customers = function (ctx) {
	const esc = isoft_insights.util.esc;
	const st = ctx.state.customers = ctx.state.customers || { limit: (ctx.state.settings.top_n || 10), search: '' };
	const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;

	ctx.$content.html(`
		<div class="ii-rowfilters">
			<label>Top</label>
			<select class="form-control ii-input" id="c-limit">${[10, 20, 50, 100].map((n) => opt(n, n, st.limit)).join('')}</select>
			<input type="text" class="form-control ii-input ii-search" id="c-search" placeholder="Search customer…" value="${esc(st.search)}" style="margin-left:auto;">
		</div>
		<div class="ii-card">
			<div class="ii-card-title"><i class="fa fa-trophy"></i> Top customers <span class="ii-pill" id="c-pill"></span></div>
			<div class="ii-chart-wrap" id="ii-cust-chart"></div>
		</div>
		<div class="ii-card">
			<div class="ii-card-title"><i class="fa fa-users"></i> Detail</div>
			<div id="ii-cust-table"></div>
		</div>
	`);

	let allRows = [];

	const renderTable = () => {
		const term = (st.search || '').toLowerCase().trim();
		const rows = allRows.filter((r) => !term ||
			(r.customer_name || '').toLowerCase().includes(term) || (r.customer || '').toLowerCase().includes(term));
		ctx.$content.find('#c-pill').text(`Top ${allRows.length} by revenue`);
		const $t = ctx.$content.find('#ii-cust-table');
		if (!rows.length) { $t.html(isoft_insights.util.empty('No customers match.')); return; }
		const max = Math.max.apply(null, rows.map((r) => flt(r.total_sales)).concat([1]));
		const body = rows.map((r, i) => `
			<tr>
				<td><span class="ii-rank">${i + 1}</span></td>
				<td><b>${esc(r.customer_name)}</b></td>
				<td>${esc(r.territory || '—')}</td>
				<td class="ii-num">${ctx.number(r.invoice_count)}</td>
				<td class="ii-num">${ctx.money(r.total_sales)}</td>
				<td class="ii-bar-cell">${isoft_insights.util.bar(r.total_sales, max)}</td>
			</tr>`).join('');
		$t.html(`<table class="ii-table">
			<thead><tr><th>#</th><th>Customer</th><th>Territory</th><th class="ii-num">Invoices</th><th class="ii-num">Revenue</th><th>Share</th></tr></thead>
			<tbody>${body}</tbody></table>`);
	};

	const renderChart = () => {
		const el = ctx.$content.find('#ii-cust-chart')[0];
		if (!el) return;
		$(el).empty();
		if (!allRows.length) { $(el).html(isoft_insights.util.empty('No customer sales in this period.')); return; }
		new frappe.Chart(el, {
			type: 'bar', height: 280,
			colors: [getComputedStyle(document.querySelector('.ii-root')).getPropertyValue('--ii-primary').trim() || '#2563eb'],
			data: { labels: allRows.map((r) => r.customer_name), datasets: [{ name: 'Revenue', values: allRows.map((r) => flt(r.total_sales)) }] },
			tooltipOptions: { formatTooltipY: (d) => ctx.money(d) }
		});
	};

	const load = () => {
		ctx.$content.find('#ii-cust-table').html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_sales_by_customer', Object.assign({}, ctx.filters, { limit: st.limit })).then((data) => {
			allRows = (data && data.rows) || [];
			renderChart();
			renderTable();
		}).catch(() => ctx.$content.find('#ii-cust-table').html(isoft_insights.util.empty('Could not load customer sales.')));
	};

	ctx.$content.find('#c-limit').on('change', function () { st.limit = cint($(this).val()); load(); });
	ctx.$content.find('#c-search').on('input', function () { st.search = $(this).val(); renderTable(); });

	load();
};
