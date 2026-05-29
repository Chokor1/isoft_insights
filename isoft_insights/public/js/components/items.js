// Isoft Insights - Sales by item / product with dynamic filters.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data for this period.'}</div>`,
	bar: (val, max) => {
		const pct = max ? Math.max(2, (flt(val) / max) * 100) : 0;
		return `<div class="ii-bar-track"><div class="ii-bar-fill" style="width:${pct}%"></div></div>`;
	}
};

isoft_insights.views.items = function (ctx) {
	const esc = isoft_insights.util.esc;
	const st = ctx.state.items = ctx.state.items || {
		limit: (ctx.state.settings.top_n || 10), item_group: '', metric: 'revenue', search: ''
	};
	const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;

	ctx.$content.html(`
		<div class="ii-rowfilters">
			<label>Metric</label>
			<select class="form-control ii-input" id="i-metric">${opt('revenue', 'Revenue', st.metric)}${opt('qty', 'Quantity', st.metric)}</select>
			<label>Top</label>
			<select class="form-control ii-input" id="i-limit">${[10, 20, 50, 100].map((n) => opt(n, n, st.limit)).join('')}</select>
			<label>Item Group</label>
			<select class="form-control ii-input" id="i-group"><option value="">All Groups</option></select>
			<input type="text" class="form-control ii-input ii-search" id="i-search" placeholder="Search product…" value="${esc(st.search)}" style="margin-left:auto;">
		</div>
		<div class="ii-card">
			<div class="ii-card-title"><i class="fa fa-bar-chart"></i> Best-selling products
				<span class="ii-pill" id="i-pill"></span>
			</div>
			<div class="ii-chart-wrap" id="ii-item-chart"></div>
		</div>
		<div class="ii-card">
			<div class="ii-card-title"><i class="fa fa-cube"></i> Detail</div>
			<div id="ii-item-table"></div>
		</div>
	`);

	const fillGroups = (groups) => {
		const $g = ctx.$content.find('#i-group');
		(groups || []).forEach((g) => $g.append(`<option value="${esc(g)}">${esc(g)}</option>`));
		$g.val(st.item_group || '');
	};
	if (ctx.state.item_groups) fillGroups(ctx.state.item_groups);
	else ctx.api('get_item_groups').then((g) => { ctx.state.item_groups = g || []; fillGroups(ctx.state.item_groups); });

	let allRows = [];
	const isQty = () => st.metric === 'qty';
	const val = (r) => isQty() ? flt(r.total_qty) : flt(r.total_sales);
	const fmt = (r) => isQty() ? ctx.number(r.total_qty) : ctx.money(r.total_sales);

	const renderTable = () => {
		const term = (st.search || '').toLowerCase().trim();
		const rows = allRows.filter((r) => !term ||
			(r.item_name || '').toLowerCase().includes(term) || (r.item_code || '').toLowerCase().includes(term));
		ctx.$content.find('#i-pill').text(`Top ${allRows.length} by ${isQty() ? 'quantity' : 'net revenue'}`);
		const $t = ctx.$content.find('#ii-item-table');
		if (!rows.length) { $t.html(isoft_insights.util.empty('No products match.')); return; }
		const max = Math.max.apply(null, rows.map(val).concat([1]));
		const body = rows.map((r, i) => `
			<tr>
				<td><span class="ii-rank">${i + 1}</span></td>
				<td><b>${esc(r.item_name)}</b><div style="font-size:11px;color:var(--ii-muted)">${esc(r.item_code)}</div></td>
				<td>${esc(r.item_group || '—')}</td>
				<td class="ii-num">${ctx.number(r.total_qty)}</td>
				<td class="ii-num">${ctx.money(r.total_sales)}</td>
				<td class="ii-bar-cell">${isoft_insights.util.bar(val(r), max)}</td>
			</tr>`).join('');
		$t.html(`<table class="ii-table">
			<thead><tr><th>#</th><th>Product</th><th>Group</th><th class="ii-num">Qty</th><th class="ii-num">Net Revenue</th><th>Share</th></tr></thead>
			<tbody>${body}</tbody></table>`);
	};

	const renderChart = () => {
		const el = ctx.$content.find('#ii-item-chart')[0];
		if (!el) return;
		$(el).empty();
		if (!allRows.length) { $(el).html(isoft_insights.util.empty('No item sales in this period.')); return; }
		new frappe.Chart(el, {
			type: 'bar', height: 280,
			colors: [getComputedStyle(document.querySelector('.ii-root')).getPropertyValue('--ii-accent').trim() || '#3b82f6'],
			data: { labels: allRows.map((r) => r.item_name), datasets: [{ name: isQty() ? 'Qty' : 'Revenue', values: allRows.map(val) }] },
			tooltipOptions: { formatTooltipY: (d) => isQty() ? ctx.number(d) : ctx.money(d) }
		});
	};

	const load = () => {
		ctx.$content.find('#ii-item-table').html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		const args = Object.assign({}, ctx.filters, {
			limit: st.limit, item_group: st.item_group || null, metric: st.metric
		});
		ctx.api('get_sales_by_item', args).then((data) => {
			allRows = (data && data.rows) || [];
			renderChart();
			renderTable();
		}).catch(() => ctx.$content.find('#ii-item-table').html(isoft_insights.util.empty('Could not load product sales.')));
	};

	ctx.$content.find('#i-metric').on('change', function () { st.metric = $(this).val(); load(); });
	ctx.$content.find('#i-limit').on('change', function () { st.limit = cint($(this).val()); load(); });
	ctx.$content.find('#i-group').on('change', function () { st.item_group = $(this).val(); load(); });
	ctx.$content.find('#i-search').on('input', function () { st.search = $(this).val(); renderTable(); });

	load();
};
