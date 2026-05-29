// Isoft Insights - Matrix: a dynamic pivot of <dimension> (rows) x time periods (columns).
// Dimension can be product, customer, brand, item group, customer group or territory.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data for this period.'}</div>`
};

isoft_insights.MATRIX_DIMS = [
	{ v: 'product', l: 'Product' },
	{ v: 'customer', l: 'Customer' },
	{ v: 'brand', l: 'Brand' },
	{ v: 'item_group', l: 'Item Group' },
	{ v: 'customer_group', l: 'Customer Group' },
	{ v: 'territory', l: 'Territory' },
	{ v: 'sales_person', l: 'Sales Person' },
	{ v: 'owner', l: 'Created By' }
];

isoft_insights.views.matrix = function (ctx) {
	const st = ctx.state.matrix = ctx.state.matrix || {
		dimension: 'product', metric: 'revenue', granularity: 'month', periods: 6,
		item_group: '', end_date: frappe.datetime.get_today()
	};
	const esc = isoft_insights.util.esc;
	const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;

	ctx.$content.html(`
		<div class="ii-card">
			<div class="ii-rowfilters">
				<label>Rows by</label>
				<select class="form-control ii-input" id="m-dim">
					${isoft_insights.MATRIX_DIMS.map((d) => opt(d.v, d.l, st.dimension)).join('')}
				</select>
				<label>Metric</label>
				<select class="form-control ii-input" id="m-metric">
					${opt('revenue', 'Revenue', st.metric)}${opt('qty', 'Quantity', st.metric)}
				</select>
				<label>By</label>
				<select class="form-control ii-input" id="m-gran">
					${opt('day', 'Day', st.granularity)}${opt('week', 'Week', st.granularity)}${opt('month', 'Month', st.granularity)}
				</select>
				<label>Periods</label>
				<select class="form-control ii-input" id="m-periods">
					${[6, 7, 12, 14, 24, 30, 36].map((n) => opt(n, n, st.periods)).join('')}
				</select>
				<label>Item Group</label>
				<select class="form-control ii-input" id="m-group"><option value="">All Groups</option></select>
				<label>Ending</label>
				<input type="date" class="form-control ii-input" id="m-end" value="${esc(st.end_date)}">
			</div>
			<div id="ii-matrix-body"><div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div></div>
		</div>
	`);

	const fillGroups = (groups) => {
		const $g = ctx.$content.find('#m-group');
		(groups || []).forEach((g) => $g.append(`<option value="${esc(g)}">${esc(g)}</option>`));
		$g.val(st.item_group || '');
	};
	if (ctx.state.item_groups) fillGroups(ctx.state.item_groups);
	else ctx.api('get_item_groups').then((g) => { ctx.state.item_groups = g || []; fillGroups(ctx.state.item_groups); });

	const fmt = (v) => st.metric === 'qty' ? ctx.number(v) : ctx.money(v);

	const renderTable = ($body, data) => {
		const cols = (data && data.columns) || [];
		const rows = (data && data.rows) || [];
		const dimLabel = (data && data.dimension_label) || 'Row';
		if (!rows.length) { $body.html(isoft_insights.util.empty('No sales in the selected window.')); return; }

		const head = `<th class="ii-sticky-col">${esc(dimLabel)}</th>` +
			cols.map((c) => `<th>${esc(c.label)}</th>`).join('') +
			`<th class="ii-total-col">Total</th>`;

		const body = rows.map((r) => {
			const rowMax = Math.max.apply(null, r.values.concat([1]));
			const cells = r.values.map((v) => {
				if (!v) return `<td class="ii-zero">·</td>`;
				const alpha = Math.min(0.20, (v / rowMax) * 0.20).toFixed(3);
				return `<td style="background:rgba(37,99,235,${alpha})">${fmt(v)}</td>`;
			}).join('');
			const sub = (r.show_code && r.key && r.key !== r.name)
				? `<div style="font-size:11px;color:var(--ii-muted)">${esc(r.key)}</div>` : '';
			return `<tr>
				<td class="ii-sticky-col"><b>${esc(r.name)}</b>${sub}</td>
				${cells}
				<td class="ii-total-col">${fmt(r.total)}</td>
			</tr>`;
		}).join('');

		const foot = `<tr>
			<td class="ii-sticky-col">Total</td>
			${(data.col_totals || []).map((v) => `<td>${fmt(v)}</td>`).join('')}
			<td>${fmt(data.grand_total)}</td>
		</tr>`;

		$body.html(`
			<div class="ii-card-title" style="margin-bottom:10px;">
				<i class="fa fa-th"></i> ${st.metric === 'qty' ? 'Quantity' : 'Revenue'} by ${esc(dimLabel.toLowerCase())} &amp; ${esc(st.granularity)}
				<span class="ii-pill">Top ${rows.length}</span>
			</div>
			<div class="ii-matrix-wrap">
				<table class="ii-matrix">
					<thead><tr>${head}</tr></thead>
					<tbody>${body}</tbody>
					<tfoot>${foot}</tfoot>
				</table>
			</div>
		`);
	};

	const load = () => {
		const $body = ctx.$content.find('#ii-matrix-body');
		$body.html('<div class="ii-loading"><i class="fa fa-spinner fa-spin"></i> Loading…</div>');
		ctx.api('get_matrix', {
			dimension: st.dimension, metric: st.metric, granularity: st.granularity, periods: st.periods,
			item_group: st.item_group || null, end_date: st.end_date || null,
			company: ctx.app.filters().company, limit: 25
		}).then((data) => renderTable($body, data)).catch(() => $body.html(isoft_insights.util.empty('Could not load the matrix.')));
	};

	ctx.$content.find('#m-dim').on('change', function () { st.dimension = $(this).val(); load(); });
	ctx.$content.find('#m-metric').on('change', function () { st.metric = $(this).val(); load(); });
	ctx.$content.find('#m-gran').on('change', function () { st.granularity = $(this).val(); load(); });
	ctx.$content.find('#m-periods').on('change', function () { st.periods = cint($(this).val()); load(); });
	ctx.$content.find('#m-group').on('change', function () { st.item_group = $(this).val(); load(); });
	ctx.$content.find('#m-end').on('change', function () { st.end_date = $(this).val(); load(); });

	load();
};
