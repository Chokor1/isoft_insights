// Isoft Insights - Sales by sales person (allocated via the Sales Team table).
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data for this period.'}</div>`,
	bar: (val, max) => {
		const pct = max ? Math.max(2, (flt(val) / max) * 100) : 0;
		return `<div class="ii-bar-track"><div class="ii-bar-fill" style="width:${pct}%"></div></div>`;
	}
};

isoft_insights.views.salesteam = function (ctx) {
	ctx.api('get_sales_by_salesperson', ctx.filters).then((data) => {
		const rows = (data && data.rows) || [];
		if (!rows.length) {
			ctx.$content.html(isoft_insights.util.empty(
				'No sales-person data for this period. Assign a Sales Team on your Sales Invoices to see this report.'
			));
			return;
		}
		const max = Math.max.apply(null, rows.map((r) => flt(r.total_sales)));

		const body = rows.map((r, i) => `
			<tr>
				<td><span class="ii-rank">${i + 1}</span></td>
				<td><b>${isoft_insights.util.esc(r.sales_person)}</b></td>
				<td class="ii-num">${ctx.number(r.invoice_count)}</td>
				<td class="ii-num">${ctx.money(r.total_sales)}</td>
				<td class="ii-bar-cell">${isoft_insights.util.bar(r.total_sales, max)}</td>
			</tr>`).join('');

		ctx.$content.html(`
			<div class="ii-card">
				<div class="ii-card-title"><i class="fa fa-line-chart"></i> Sales-person performance
					<span class="ii-pill">Allocated by Sales Team %</span>
				</div>
				<div class="ii-chart-wrap" id="ii-sp-chart"></div>
			</div>
			<div class="ii-card">
				<div class="ii-card-title"><i class="fa fa-user-circle"></i> Detail</div>
				<table class="ii-table">
					<thead><tr>
						<th>#</th><th>Sales Person</th>
						<th class="ii-num">Invoices</th><th class="ii-num">Allocated Revenue</th><th>Share</th>
					</tr></thead>
					<tbody>${body}</tbody>
				</table>
			</div>
		`);

		const el = ctx.$content.find('#ii-sp-chart')[0];
		if (el) {
			new frappe.Chart(el, {
				type: 'bar',
				height: 280,
				colors: [getComputedStyle(document.querySelector('.ii-root')).getPropertyValue('--ii-primary').trim() || '#2563eb'],
				data: {
					labels: rows.map((r) => r.sales_person),
					datasets: [{ name: 'Allocated Revenue', values: rows.map((r) => flt(r.total_sales)) }]
				},
				tooltipOptions: { formatTooltipY: (d) => ctx.money(d) }
			});
		}
	}).catch(() => ctx.$content.html(isoft_insights.util.empty('Could not load sales-person data.')));
};
