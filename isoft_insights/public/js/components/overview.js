// Isoft Insights - Overview: KPI cards + sales-over-time trend chart.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data for this period.'}</div>`,
	bar: (val, max) => {
		const pct = max ? Math.max(2, (flt(val) / max) * 100) : 0;
		return `<div class="ii-bar-track"><div class="ii-bar-fill" style="width:${pct}%"></div></div>`;
	}
};

isoft_insights.views.overview = function (ctx) {
	ctx.api('get_sales_overview', ctx.filters).then((data) => {
		const k = (data && data.kpis) || {};
		const trend = (data && data.trend) || { labels: [], values: [] };

		let delta = '<span class="ii-kpi-delta ii-flat">vs previous period: n/a</span>';
		if (k.growth_pct !== null && k.growth_pct !== undefined) {
			const up = k.growth_pct >= 0;
			const cls = up ? 'ii-up' : 'ii-down';
			const arrow = up ? '▲' : '▼';
			delta = `<span class="ii-kpi-delta ${cls}">${arrow} ${Math.abs(k.growth_pct).toFixed(1)}% vs prev. period</span>`;
		}

		ctx.$content.html(`
			<div class="ii-grid">
				<div class="ii-kpi">
					<div class="ii-kpi-icon"><i class="fa fa-money"></i></div>
					<div class="ii-kpi-label">Total Sales</div>
					<div class="ii-kpi-value">${ctx.money(k.total_sales)}</div>
					${delta}
				</div>
				<div class="ii-kpi">
					<div class="ii-kpi-icon"><i class="fa fa-file-text-o"></i></div>
					<div class="ii-kpi-label">Invoices</div>
					<div class="ii-kpi-value">${ctx.number(k.invoice_count)}</div>
				</div>
				<div class="ii-kpi">
					<div class="ii-kpi-icon"><i class="fa fa-shopping-cart"></i></div>
					<div class="ii-kpi-label">Avg. Order Value</div>
					<div class="ii-kpi-value">${ctx.money(k.avg_order_value)}</div>
				</div>
				<div class="ii-kpi">
					<div class="ii-kpi-icon"><i class="fa fa-users"></i></div>
					<div class="ii-kpi-label">Active Customers</div>
					<div class="ii-kpi-value">${ctx.number(k.customer_count)}</div>
				</div>
			</div>

			<div class="ii-card">
				<div class="ii-card-title">
					<i class="fa fa-area-chart"></i> Sales over time
					<span class="ii-pill">${trend.granularity === 'day' ? 'Daily' : 'Monthly'}</span>
				</div>
				<div class="ii-chart-wrap" id="ii-trend-chart"></div>
			</div>
		`);

		const el = ctx.$content.find('#ii-trend-chart')[0];
		if (el && trend.labels && trend.labels.length) {
			new frappe.Chart(el, {
				type: 'line',
				height: 290,
				colors: [getComputedStyle(document.querySelector('.ii-root')).getPropertyValue('--ii-accent').trim() || '#3b82f6'],
				lineOptions: { regionFill: 1, hideDots: trend.labels.length > 40 ? 1 : 0 },
				axisOptions: { xIsSeries: 1 },
				data: {
					labels: trend.labels,
					datasets: [{ name: 'Sales', values: trend.values }]
				},
				tooltipOptions: { formatTooltipY: (d) => ctx.money(d) }
			});
		} else if (el) {
			$(el).html(isoft_insights.util.empty('No sales in this period.'));
		}
	}).catch(() => {
		ctx.$content.html(isoft_insights.util.empty('Could not load the overview.'));
	});
};
