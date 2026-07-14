# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# Backend for the Isoft Insights sales analytics app.
# All UI-facing endpoints are whitelisted and guarded by _assert_access().

import ast

import frappe
from frappe import _
from frappe.utils import (
	add_days,
	add_months,
	cint,
	flt,
	get_first_day,
	get_last_day,
	getdate,
	today,
)


SETTINGS_DOCTYPE = "Isoft Insights Settings"
ANGOLA_PL_DOCTYPE = "Isoft Angola Income Statement Settings"
ANGOLA_PL_TITLE = "Demonstração de Resultados"


# --------------------------------------------------------------------------- #
# Settings & access control
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_insights_settings():
	"""Return the Isoft Insights settings as a plain dict for the front-end."""
	s = frappe.get_single(SETTINGS_DOCTYPE)

	def _lines(value):
		return [v.strip() for v in (value or "").splitlines() if v.strip()]

	default_company = s.default_company or frappe.defaults.get_user_default("Company")
	currency = s.default_currency or _company_currency(default_company)

	return {
		"default_company": default_company,
		"default_currency": currency,
		"default_period": s.default_period or "This Year",
		"top_n": cint(s.top_n) or 10,
		"access_mode": s.access_mode or "By Role",
		"allowed_roles": _lines(s.allowed_roles) or ["Sales Manager"],
		"allowed_users": _lines(s.allowed_users),
		"can_access": 1 if _has_access() else 0,
		"can_manage": 1 if ("System Manager" in frappe.get_roles()) else 0,
	}


def _has_access():
	"""True if the current user may use Isoft Insights (mirrors the settings)."""
	user = frappe.session.user
	# Administrator is always allowed as a safety hatch; every other user
	# (including System Manager) must be granted access explicitly.
	if user == "Administrator":
		return True

	roles = set(frappe.get_roles(user))

	s = frappe.get_single(SETTINGS_DOCTYPE)
	mode = (s.access_mode or "By Role").strip().lower()

	if mode == "by user":
		allowed = [u.strip() for u in (s.allowed_users or "").splitlines() if u.strip()]
		return user in allowed

	allowed_roles = [r.strip() for r in (s.allowed_roles or "").splitlines() if r.strip()] or [
		"Isoft Insights User"
	]
	return bool(roles.intersection(allowed_roles))


@frappe.whitelist()
def can_access_insights():
	"""Lightweight check used by the navbar icon and page guard."""
	return 1 if _has_access() else 0


def _assert_access():
	if not _has_access():
		frappe.throw(_("You are not permitted to access Isoft Insights."), frappe.PermissionError)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _company_currency(company):
	if company:
		cur = frappe.db.get_value("Company", company, "default_currency")
		if cur:
			return cur
	return frappe.db.get_default("currency") or "USD"


def _variation(cur, prev, polarity="good_up"):
	"""Year-over-year change: (amount, pct, status).

	status is 'good' | 'bad' | 'flat' from the viewer's perspective. For revenue /
	result / asset lines (good_up) an increase is good; for cost / tax / liability
	lines (good_down) a decrease is good.
	"""
	if cur is None or prev is None:
		return None, None, None
	diff = flt(cur) - flt(prev)
	pct = (diff / abs(flt(prev)) * 100.0) if flt(prev) else None
	if abs(diff) < 0.005:
		status = "flat"
	elif polarity == "good_down":
		status = "good" if diff < 0 else "bad"
	else:
		status = "good" if diff > 0 else "bad"
	return diff, pct, status


def _resolve_period(period=None, from_date=None, to_date=None):
	"""Return (from_date, to_date) as date objects.

	If explicit from_date/to_date are given they win; otherwise derive the range
	from a named period. 'All Time' returns (None, today).
	"""
	if from_date and to_date:
		return getdate(from_date), getdate(to_date)

	period = period or "This Year"
	t = getdate(today())

	if period == "This Month":
		return get_first_day(t), get_last_day(t)
	if period == "This Quarter":
		quarter = (t.month - 1) // 3
		start_month = quarter * 3 + 1
		start = t.replace(month=start_month, day=1)
		return start, get_last_day(add_months(start, 2))
	if period == "This Year":
		return t.replace(month=1, day=1), t.replace(month=12, day=31)
	if period == "Last 12 Months":
		start = add_months(get_first_day(t), -11)
		return start, get_last_day(t)
	if period == "All Time":
		return None, t

	# Fallback: this year
	return t.replace(month=1, day=1), t.replace(month=12, day=31)


def _date_conditions(from_date, to_date, alias="si"):
	"""Build a parameterised posting_date condition + params dict."""
	conditions = ["{0}.docstatus = 1".format(alias)]
	params = {}
	if from_date:
		conditions.append("{0}.posting_date >= %(from_date)s".format(alias))
		params["from_date"] = getdate(from_date)
	if to_date:
		conditions.append("{0}.posting_date <= %(to_date)s".format(alias))
		params["to_date"] = getdate(to_date)
	return conditions, params


def _maybe_company(conditions, params, company, alias="si"):
	if company:
		conditions.append("{0}.company = %(company)s".format(alias))
		params["company"] = company
	return conditions, params


# --------------------------------------------------------------------------- #
# Analytics endpoints
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_sales_overview(period=None, from_date=None, to_date=None, company=None):
	"""KPI cards + a sales-over-time trend series."""
	_assert_access()
	from_date, to_date = _resolve_period(period, from_date, to_date)
	currency = _company_currency(company)

	conditions, params = _date_conditions(from_date, to_date)
	conditions, params = _maybe_company(conditions, params, company)
	where = " AND ".join(conditions)

	totals = frappe.db.sql(
		"""
		SELECT
			COALESCE(SUM(si.base_grand_total), 0) AS total_sales,
			COUNT(si.name)                        AS invoice_count,
			COUNT(DISTINCT si.customer)           AS customer_count
		FROM `tabSales Invoice` si
		WHERE {where}
		""".format(where=where),
		params,
		as_dict=True,
	)[0]

	total_sales = flt(totals.total_sales)
	invoice_count = cint(totals.invoice_count)
	avg_order_value = (total_sales / invoice_count) if invoice_count else 0

	# Previous comparable period for growth %
	growth_pct = None
	if from_date and to_date:
		span = (getdate(to_date) - getdate(from_date)).days
		prev_to = add_days(getdate(from_date), -1)
		prev_from = add_days(prev_to, -span)
		p_cond, p_params = _date_conditions(prev_from, prev_to)
		p_cond, p_params = _maybe_company(p_cond, p_params, company)
		prev_total = flt(
			frappe.db.sql(
				"""
				SELECT COALESCE(SUM(si.base_grand_total), 0)
				FROM `tabSales Invoice` si
				WHERE {where}
				""".format(where=" AND ".join(p_cond)),
				p_params,
			)[0][0]
		)
		if prev_total:
			growth_pct = (total_sales - prev_total) / prev_total * 100.0

	# Trend: daily for short spans, monthly otherwise
	trend = _sales_trend(from_date, to_date, company)

	return {
		"currency": currency,
		"from_date": str(from_date) if from_date else None,
		"to_date": str(to_date) if to_date else None,
		"kpis": {
			"total_sales": total_sales,
			"invoice_count": invoice_count,
			"avg_order_value": avg_order_value,
			"customer_count": cint(totals.customer_count),
			"growth_pct": growth_pct,
		},
		"trend": trend,
	}


def _sales_trend(from_date, to_date, company):
	conditions, params = _date_conditions(from_date, to_date)
	conditions, params = _maybe_company(conditions, params, company)
	where = " AND ".join(conditions)

	# Decide granularity
	daily = False
	if from_date and to_date:
		daily = (getdate(to_date) - getdate(from_date)).days <= 62

	if daily:
		fmt = "%%Y-%%m-%%d"
		label_expr = "DATE_FORMAT(si.posting_date, '{0}')".format(fmt)
	else:
		label_expr = "DATE_FORMAT(si.posting_date, '%%Y-%%m')"

	rows = frappe.db.sql(
		"""
		SELECT {label} AS bucket,
			COALESCE(SUM(si.base_grand_total), 0) AS amount
		FROM `tabSales Invoice` si
		WHERE {where}
		GROUP BY bucket
		ORDER BY bucket
		""".format(label=label_expr, where=where),
		params,
		as_dict=True,
	)

	return {
		"labels": [r.bucket for r in rows],
		"values": [flt(r.amount) for r in rows],
		"granularity": "day" if daily else "month",
	}


@frappe.whitelist()
def get_sales_by_customer(period=None, from_date=None, to_date=None, company=None, limit=None):
	"""Top customers by revenue."""
	_assert_access()
	from_date, to_date = _resolve_period(period, from_date, to_date)
	currency = _company_currency(company)
	limit = cint(limit) or 10

	conditions, params = _date_conditions(from_date, to_date)
	conditions, params = _maybe_company(conditions, params, company)
	params["limit"] = limit
	where = " AND ".join(conditions)

	rows = frappe.db.sql(
		"""
		SELECT
			si.customer AS customer,
			COALESCE(si.customer_name, si.customer) AS customer_name,
			si.territory AS territory,
			COALESCE(SUM(si.base_grand_total), 0) AS total_sales,
			COUNT(si.name) AS invoice_count
		FROM `tabSales Invoice` si
		WHERE {where}
		GROUP BY si.customer, si.customer_name, si.territory
		ORDER BY total_sales DESC
		LIMIT %(limit)s
		""".format(where=where),
		params,
		as_dict=True,
	)

	return {"currency": currency, "rows": rows}


@frappe.whitelist()
def get_sales_by_item(
	period=None, from_date=None, to_date=None, company=None, limit=None, item_group=None, metric=None
):
	"""Top items by net revenue and quantity, with optional item-group filter."""
	_assert_access()
	from_date, to_date = _resolve_period(period, from_date, to_date)
	currency = _company_currency(company)
	limit = cint(limit) or 10
	metric = (metric or "revenue").lower()

	conditions, params = _date_conditions(from_date, to_date)
	conditions, params = _maybe_company(conditions, params, company)
	if item_group:
		conditions.append("sii.item_group = %(item_group)s")
		params["item_group"] = item_group
	params["limit"] = limit
	where = " AND ".join(conditions)
	order_by = "total_qty DESC" if metric == "qty" else "total_sales DESC"

	rows = frappe.db.sql(
		"""
		SELECT
			sii.item_code AS item_code,
			COALESCE(sii.item_name, sii.item_code) AS item_name,
			sii.item_group AS item_group,
			COALESCE(SUM(sii.base_net_amount), 0) AS total_sales,
			COALESCE(SUM(sii.qty), 0) AS total_qty
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE {where}
		GROUP BY sii.item_code, sii.item_name, sii.item_group
		ORDER BY {order_by}
		LIMIT %(limit)s
		""".format(where=where, order_by=order_by),
		params,
		as_dict=True,
	)

	return {"currency": currency, "rows": rows, "metric": metric}


@frappe.whitelist()
def get_item_groups():
	"""Leaf item groups for the matrix / item filters."""
	_assert_access()
	return frappe.get_all(
		"Item Group", filters={"is_group": 0}, order_by="name", pluck="name"
	)


@frappe.whitelist()
def get_customer_balance(as_on_date=None, company=None, only_overdue=0):
	"""Customer receivables with an aging breakdown (current / 1-30 / 31-60 / 61-90 / 90+).

	Derived from submitted Sales Invoices with an outstanding balance. Amounts are
	converted to company currency via the invoice conversion rate.
	"""
	_assert_access()
	as_on = getdate(as_on_date) if as_on_date else getdate(today())
	currency = _company_currency(company)

	conds = ["si.docstatus = 1", "si.outstanding_amount > 0"]
	params = {"as_on": as_on}
	if company:
		conds.append("si.company = %(company)s")
		params["company"] = company
	if cint(only_overdue):
		conds.append("COALESCE(si.due_date, si.posting_date) < %(as_on)s")
	where = " AND ".join(conds)

	rows = frappe.db.sql(
		"""
		SELECT
			customer,
			MAX(customer_name) AS customer_name,
			COALESCE(SUM(out_base), 0) AS total_outstanding,
			COALESCE(SUM(CASE WHEN days <= 0 THEN out_base ELSE 0 END), 0) AS current_amt,
			COALESCE(SUM(CASE WHEN days BETWEEN 1 AND 30 THEN out_base ELSE 0 END), 0) AS b1_30,
			COALESCE(SUM(CASE WHEN days BETWEEN 31 AND 60 THEN out_base ELSE 0 END), 0) AS b31_60,
			COALESCE(SUM(CASE WHEN days BETWEEN 61 AND 90 THEN out_base ELSE 0 END), 0) AS b61_90,
			COALESCE(SUM(CASE WHEN days > 90 THEN out_base ELSE 0 END), 0) AS b90_plus,
			COUNT(*) AS invoice_count
		FROM (
			SELECT
				si.customer AS customer,
				COALESCE(si.customer_name, si.customer) AS customer_name,
				si.outstanding_amount * COALESCE(si.conversion_rate, 1) AS out_base,
				DATEDIFF(%(as_on)s, COALESCE(si.due_date, si.posting_date)) AS days
			FROM `tabSales Invoice` si
			WHERE {where}
		) t
		GROUP BY customer
		ORDER BY total_outstanding DESC
		""".format(where=where),
		params,
		as_dict=True,
	)

	# Real customer balance from the GL (includes unlinked payments, journal
	# entries, credit notes, advances) - can differ from the sum of outstanding
	# invoices when receipts are not allocated against specific invoices.
	customers = [r.customer for r in rows if r.customer]
	balances = {}
	if customers:
		gl_conds = [
			"gle.party_type = 'Customer'",
			"gle.is_cancelled = 0",
			"gle.posting_date <= %(as_on)s",
			"gle.party IN %(customers)s",
		]
		gl_params = {"as_on": as_on, "customers": tuple(customers)}
		if company:
			gl_conds.append("gle.company = %(company)s")
			gl_params["company"] = company
		gl_rows = frappe.db.sql(
			"""
			SELECT gle.party AS customer, COALESCE(SUM(gle.debit - gle.credit), 0) AS balance
			FROM `tabGL Entry` gle
			WHERE {gl_where}
			GROUP BY gle.party
			""".format(gl_where=" AND ".join(gl_conds)),
			gl_params,
			as_dict=True,
		)
		balances = {b.customer: flt(b.balance) for b in gl_rows}

	for r in rows:
		r["balance"] = balances.get(r.customer, 0.0)

	totals = {
		"total_outstanding": sum(flt(r.total_outstanding) for r in rows),
		"balance": sum(flt(r.balance) for r in rows),
		"current_amt": sum(flt(r.current_amt) for r in rows),
		"b1_30": sum(flt(r.b1_30) for r in rows),
		"b31_60": sum(flt(r.b31_60) for r in rows),
		"b61_90": sum(flt(r.b61_90) for r in rows),
		"b90_plus": sum(flt(r.b90_plus) for r in rows),
	}

	return {"currency": currency, "as_on": str(as_on), "rows": rows, "totals": totals}


@frappe.whitelist()
def get_customer_open_invoices(customer, as_on_date=None, company=None):
	"""Open (outstanding) invoices for one customer - used for the receivables drill-down."""
	_assert_access()
	as_on = getdate(as_on_date) if as_on_date else getdate(today())
	currency = _company_currency(company)

	conds = ["si.docstatus = 1", "si.outstanding_amount > 0", "si.customer = %(customer)s"]
	params = {"customer": customer, "as_on": as_on}
	if company:
		conds.append("si.company = %(company)s")
		params["company"] = company
	where = " AND ".join(conds)

	rows = frappe.db.sql(
		"""
		SELECT
			si.name AS invoice,
			si.posting_date AS posting_date,
			si.due_date AS due_date,
			si.status AS status,
			si.grand_total * COALESCE(si.conversion_rate, 1) AS grand_total,
			si.outstanding_amount * COALESCE(si.conversion_rate, 1) AS outstanding,
			DATEDIFF(%(as_on)s, COALESCE(si.due_date, si.posting_date)) AS days_overdue
		FROM `tabSales Invoice` si
		WHERE {where}
		ORDER BY si.posting_date
		""".format(where=where),
		params,
		as_dict=True,
	)

	return {"currency": currency, "rows": rows}


# dimension key -> SQL expressions for the matrix row grouping.
MATRIX_DIMENSIONS = {
	"product": {
		"key": "sii.item_code",
		"name": "MAX(COALESCE(sii.item_name, sii.item_code))",
		"label": "Product",
		"has_code": True,
	},
	"item_group": {
		"key": "COALESCE(NULLIF(sii.item_group, ''), 'Not Set')",
		"name": "COALESCE(NULLIF(sii.item_group, ''), 'Not Set')",
		"label": "Item Group",
		"has_code": False,
	},
	"brand": {
		"key": "COALESCE(NULLIF(sii.brand, ''), 'Not Set')",
		"name": "COALESCE(NULLIF(sii.brand, ''), 'Not Set')",
		"label": "Brand",
		"has_code": False,
	},
	"customer": {
		"key": "si.customer",
		"name": "MAX(COALESCE(si.customer_name, si.customer))",
		"label": "Customer",
		"has_code": True,
	},
	"customer_group": {
		"key": "COALESCE(NULLIF(si.customer_group, ''), 'Not Set')",
		"name": "COALESCE(NULLIF(si.customer_group, ''), 'Not Set')",
		"label": "Customer Group",
		"has_code": False,
	},
	"territory": {
		"key": "COALESCE(NULLIF(si.territory, ''), 'Not Set')",
		"name": "COALESCE(NULLIF(si.territory, ''), 'Not Set')",
		"label": "Territory",
		"has_code": False,
	},
	"owner": {
		"key": "si.owner",
		"name": "COALESCE((SELECT u.full_name FROM `tabUser` u WHERE u.name = si.owner), si.owner)",
		"label": "Created By (Owner)",
		"has_code": True,
	},
	"sales_person": {
		"key": "st.sales_person",
		"name": "st.sales_person",
		"label": "Sales Person",
		"has_code": False,
		# Join the Sales Team child table and allocate revenue by the sales person's share.
		"join": "INNER JOIN `tabSales Team` st ON st.parent = si.name AND st.parenttype = 'Sales Invoice'",
		"mult": " * COALESCE(st.allocated_percentage, 0) / 100.0",
	},
}


@frappe.whitelist()
def get_matrix(
	dimension=None, metric=None, granularity=None, periods=None, end_date=None,
	item_group=None, company=None, limit=None
):
	"""Dynamic pivot: <dimension> (rows) x time-period (columns).

	dimension: product | item_group | brand | customer | customer_group | territory.
	metric: 'revenue' (net amount) or 'qty'. granularity: 'day' | 'week' | 'month'.
	periods: number of trailing time buckets ending at end_date.
	"""
	_assert_access()
	from datetime import timedelta

	dimension = (dimension or "product").lower()
	dim = MATRIX_DIMENSIONS.get(dimension) or MATRIX_DIMENSIONS["product"]
	metric = (metric or "revenue").lower()
	granularity = (granularity or "month").lower()
	periods = max(1, min(cint(periods) or 6, 36))
	limit = max(1, min(cint(limit) or 20, 100))
	end = getdate(end_date) if end_date else getdate(today())
	currency = _company_currency(company)

	cols = []
	if granularity == "day":
		for i in range(periods - 1, -1, -1):
			d = end - timedelta(days=i)
			cols.append({"key": d.strftime("%Y-%m-%d"), "label": d.strftime("%d %b")})
		start = end - timedelta(days=periods - 1)
		bucket = "DATE_FORMAT(si.posting_date, '%%Y-%%m-%%d')"
	elif granularity == "week":
		monday = end - timedelta(days=end.weekday())
		for i in range(periods - 1, -1, -1):
			d = monday - timedelta(weeks=i)
			cols.append({"key": d.strftime("%Y-%m-%d"), "label": d.strftime("%d %b")})
		start = monday - timedelta(weeks=periods - 1)
		bucket = "DATE_FORMAT(DATE_SUB(si.posting_date, INTERVAL WEEKDAY(si.posting_date) DAY), '%%Y-%%m-%%d')"
	else:
		granularity = "month"
		first = get_first_day(end)
		for i in range(periods - 1, -1, -1):
			d = add_months(first, -i)
			cols.append({"key": d.strftime("%Y-%m"), "label": d.strftime("%b %y")})
		start = add_months(first, -(periods - 1))
		bucket = "DATE_FORMAT(si.posting_date, '%%Y-%%m')"

	value_base = "sii.qty" if metric == "qty" else "sii.base_net_amount"
	value_expr = value_base + dim.get("mult", "")

	conds = ["si.docstatus = 1", "si.posting_date >= %(start)s", "si.posting_date <= %(end)s"]
	params = {"start": start, "end": end}
	if company:
		conds.append("si.company = %(company)s")
		params["company"] = company
	if item_group:
		conds.append("sii.item_group = %(item_group)s")
		params["item_group"] = item_group
	where = " AND ".join(conds)

	data = frappe.db.sql(
		"""
		SELECT
			{key} AS dkey,
			{name} AS dname,
			{bucket} AS pkey,
			COALESCE(SUM({value}), 0) AS val
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		{join}
		WHERE {where}
		GROUP BY {key}, pkey
		""".format(
			key=dim["key"], name=dim["name"], bucket=bucket, value=value_expr,
			join=dim.get("join", ""), where=where
		),
		params,
		as_dict=True,
	)

	groups = {}
	for r in data:
		g = groups.setdefault(
			r.dkey,
			{"key": r.dkey, "name": r.dname, "cells": {}, "total": 0},
		)
		g["cells"][r.pkey] = flt(r.val)
		g["total"] += flt(r.val)

	ordered = sorted(groups.values(), key=lambda x: x["total"], reverse=True)[:limit]
	col_keys = [c["key"] for c in cols]
	rows = []
	for g in ordered:
		values = [flt(g["cells"].get(k, 0)) for k in col_keys]
		rows.append(
			{
				"key": g["key"],
				"name": g["name"],
				"show_code": dim["has_code"],
				"values": values,
				"total": g["total"],
			}
		)

	col_totals = [sum(r["values"][i] for r in rows) for i in range(len(col_keys))]
	grand_total = sum(r["total"] for r in rows)

	return {
		"currency": currency,
		"dimension": dimension,
		"dimension_label": dim["label"],
		"metric": metric,
		"granularity": granularity,
		"columns": cols,
		"rows": rows,
		"col_totals": col_totals,
		"grand_total": grand_total,
	}


@frappe.whitelist()
def get_sales_by_territory(period=None, from_date=None, to_date=None, company=None):
	"""Revenue grouped by territory."""
	_assert_access()
	from_date, to_date = _resolve_period(period, from_date, to_date)
	currency = _company_currency(company)

	conditions, params = _date_conditions(from_date, to_date)
	conditions, params = _maybe_company(conditions, params, company)
	where = " AND ".join(conditions)

	rows = frappe.db.sql(
		"""
		SELECT
			COALESCE(NULLIF(si.territory, ''), 'Not Set') AS territory,
			COALESCE(SUM(si.base_grand_total), 0) AS total_sales,
			COUNT(si.name) AS invoice_count
		FROM `tabSales Invoice` si
		WHERE {where}
		GROUP BY si.territory
		ORDER BY total_sales DESC
		""".format(where=where),
		params,
		as_dict=True,
	)

	return {"currency": currency, "rows": rows}


@frappe.whitelist()
def get_sales_by_salesperson(period=None, from_date=None, to_date=None, company=None):
	"""Revenue grouped by sales person (via the Sales Team child table).

	Revenue is allocated to each sales person by their allocated_percentage on
	the invoice. Invoices without a sales team are reported under 'Unassigned'.
	"""
	_assert_access()
	from_date, to_date = _resolve_period(period, from_date, to_date)
	currency = _company_currency(company)

	conditions, params = _date_conditions(from_date, to_date)
	conditions, params = _maybe_company(conditions, params, company)
	where = " AND ".join(conditions)

	# Allocated revenue per sales person
	assigned = frappe.db.sql(
		"""
		SELECT
			st.sales_person AS sales_person,
			COALESCE(SUM(si.base_grand_total * COALESCE(st.allocated_percentage, 0) / 100.0), 0) AS total_sales,
			COUNT(DISTINCT si.name) AS invoice_count
		FROM `tabSales Team` st
		INNER JOIN `tabSales Invoice` si ON si.name = st.parent
		WHERE {where} AND st.parenttype = 'Sales Invoice'
		GROUP BY st.sales_person
		HAVING total_sales <> 0
		ORDER BY total_sales DESC
		""".format(where=where),
		params,
		as_dict=True,
	)

	return {"currency": currency, "rows": assigned}


@frappe.whitelist()
def get_companies():
	"""List of companies for the company filter."""
	_assert_access()
	return frappe.get_all("Company", fields=["name"], order_by="name", pluck="name")


@frappe.whitelist()
def get_roles_list():
	"""Assignable roles, for the access-control settings UI."""
	_assert_access()
	roles = frappe.get_all("Role", filters={"disabled": 0}, order_by="name", pluck="name")
	skip = {"Administrator", "Guest", "All"}
	return [r for r in roles if r not in skip]


@frappe.whitelist()
def save_insights_settings(payload):
	"""Save Isoft Insights settings. System Manager only."""
	if "System Manager" not in frappe.get_roles() and frappe.session.user != "Administrator":
		frappe.throw(_("Only a System Manager can change Isoft Insights settings."), frappe.PermissionError)

	if isinstance(payload, str):
		payload = frappe.parse_json(payload)
	payload = payload or {}

	s = frappe.get_single(SETTINGS_DOCTYPE)

	def _norm_lines(value):
		if isinstance(value, (list, tuple)):
			items = [str(v).strip() for v in value]
		else:
			items = [v.strip() for v in str(value or "").splitlines()]
		return "\n".join([v for v in items if v])

	allowed_fields = {
		"default_company", "default_currency", "default_period", "top_n", "access_mode",
	}
	for f in allowed_fields:
		if f in payload:
			s.set(f, payload.get(f))

	if "allowed_roles" in payload:
		s.allowed_roles = _norm_lines(payload.get("allowed_roles"))
	if "allowed_users" in payload:
		s.allowed_users = _norm_lines(payload.get("allowed_users"))

	s.save(ignore_permissions=True)
	frappe.db.commit()
	return get_insights_settings()


# --------------------------------------------------------------------------- #
# Angola income statement — Cálculo de Lucros e Perdas
# --------------------------------------------------------------------------- #
#
# The statement STRUCTURE, labels, footnote numbers and formulas are fixed here
# in code. The only thing configured in "Isoft Angola Income Statement Settings"
# is which Account each line maps to (searchable Link fields, empty by default).
#
# Line kinds:
#   magnitude : positive value of one account's sub-tree (income => credit-debit,
#               expense => debit-credit). Used for revenue, costs and taxes.
#   net       : natural (credit - debit) sum of one or two accounts. Used for the
#               financial / non-operational / extraordinary results where the
#               value is Proveitos - Custos and may be positive or negative.
#   formula   : arithmetic over other rows (row codes). Totals & results.

ANGOLA_STATEMENT = [
	{"code": "vendas", "label": "Vendas", "notas": "22", "kind": "magnitude", "field": "acc_vendas"},
	{"code": "servicos", "label": "Prestações de serviços", "notas": "23", "kind": "magnitude", "field": "acc_servicos"},
	{"code": "outros_prov_op", "label": "Outros proveitos operacionais", "notas": "24", "kind": "magnitude", "field": "acc_outros_prov_op"},
	{"code": "total_prov_op", "label": "Total de Proveitos Operacionais", "notas": "", "kind": "formula", "expr": "vendas + servicos + outros_prov_op", "bold": 1},
	{"code": "variacoes", "label": "Variações nos produtos acabados e produtos em vias de fabrico", "notas": "25", "kind": "magnitude", "field": "acc_variacoes"},
	{"code": "trabalhos", "label": "Trabalhos para a própria empresa", "notas": "", "kind": "magnitude", "field": "acc_trabalhos"},
	{"code": "cmvmc", "label": "Custo das mercadorias vendidas e das matérias primas e subsidiárias consumidas", "notas": "27", "kind": "magnitude", "field": "acc_cmvmc"},
	{"code": "custos_pessoal", "label": "Custos com o Pessoal", "notas": "28", "kind": "magnitude", "field": "acc_custos_pessoal"},
	{"code": "amortizacoes", "label": "Amortizações", "notas": "29", "kind": "magnitude", "field": "acc_amortizacoes"},
	{"code": "outros_custos_op", "label": "Outros custos e perdas operacionais", "notas": "30", "kind": "magnitude", "field": "acc_outros_custos_op"},
	{"code": "total_custos_op", "label": "Total de Custos Operacionais", "notas": "", "kind": "formula", "expr": "variacoes + trabalhos + cmvmc + custos_pessoal + amortizacoes + outros_custos_op", "bold": 1},
	{"code": "res_operacionais", "label": "Resultados Operacionais", "notas": "", "kind": "formula", "expr": "total_prov_op - total_custos_op", "bold": 1},
	{"code": "res_financeiros", "label": "Resultados financeiros", "notas": "31", "kind": "net", "fields": ["acc_fin_proveitos", "acc_fin_custos"]},
	{"code": "res_filiais", "label": "Resultados de filiais e associadas", "notas": "", "kind": "net", "fields": ["acc_res_filiais"]},
	{"code": "res_nao_op", "label": "Resultados não operacionais", "notas": "33", "kind": "net", "fields": ["acc_naoop_proveitos", "acc_naoop_custos"]},
	{"code": "res_antes_impostos", "label": "Resultados antes de impostos", "notas": "", "kind": "formula", "expr": "res_operacionais + res_financeiros + res_filiais + res_nao_op", "bold": 1},
	{"code": "impostos_rendimento", "label": "Impostos sobre o rendimento", "notas": "35", "kind": "magnitude", "field": "acc_impostos_rendimento"},
	{"code": "res_liq_correntes", "label": "Resultados líquidos das actividades correntes", "notas": "", "kind": "formula", "expr": "res_antes_impostos - impostos_rendimento", "bold": 1},
	{"code": "res_extraord", "label": "Resultados extraordinários", "notas": "34", "kind": "net", "fields": ["acc_extra_proveitos", "acc_extra_custos"]},
	{"code": "imposto_rend_extra", "label": "Imposto sobre o rendimento", "notas": "35", "kind": "magnitude", "field": "acc_imposto_rend_extra"},
	{"code": "res_liq_exercicio", "label": "Resultados líquidos do exercício", "notas": "", "kind": "formula", "expr": "res_liq_correntes + res_extraord - imposto_rend_extra", "bold": 1},
]

# All account Link fieldnames on the settings doctype.
ANGOLA_ACCOUNT_FIELDS = [f["field"] for f in ANGOLA_STATEMENT if f["kind"] == "magnitude"] + [
	fld for f in ANGOLA_STATEMENT if f["kind"] == "net" for fld in f["fields"]
]

# Lines where a HIGHER value is unfavorable (costs & taxes) — drives variation colour.
PL_COST_CODES = {
	"variacoes", "trabalhos", "cmvmc", "custos_pessoal", "amortizacoes", "outros_custos_op",
	"total_custos_op", "impostos_rendimento", "imposto_rend_extra",
}

# Standard Angola (PGC-A) account numbers per settings field. Used by the
# "auto-fill standard accounts" action to resolve each field to the real account
# in the selected company's chart (matched by Account Number). None = no standard
# number (map it manually if the company uses one).
ANGOLA_STANDARD_NUMBERS = {
	"acc_vendas": "61",
	"acc_servicos": "62",
	"acc_outros_prov_op": "63",
	"acc_variacoes": "64",
	"acc_trabalhos": "65",
	"acc_cmvmc": "71",
	"acc_custos_pessoal": "72",
	"acc_amortizacoes": "73",
	"acc_outros_custos_op": "75",
	"acc_fin_proveitos": "66",
	"acc_fin_custos": "76",
	"acc_res_filiais": None,
	"acc_naoop_proveitos": "68",
	"acc_naoop_custos": "78",
	"acc_impostos_rendimento": "3411",
	"acc_imposto_rend_extra": None,
	"acc_extra_proveitos": "69",
	"acc_extra_custos": "79",
}


@frappe.whitelist()
def automap_angola_accounts(overwrite=0):
	"""Fill each account field from its standard PGC-A number, matched in the
	selected company's chart. Existing values are kept unless overwrite=1.
	Returns which numbers were filled and which were not found."""
	if not _can_manage_angola():
		frappe.throw(_("Only an Accounts / System Manager can map the accounts."), frappe.PermissionError)

	doc = frappe.get_single(ANGOLA_PL_DOCTYPE)
	company = doc.default_company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Set the Company first, then map the standard accounts."))

	overwrite = cint(overwrite)
	filled, not_found = [], []
	for field, number in ANGOLA_STANDARD_NUMBERS.items():
		if not number:
			continue
		if doc.get(field) and not overwrite:
			continue
		account = frappe.db.get_value(
			"Account", {"account_number": number, "company": company}, "name"
		)
		if account:
			doc.set(field, account)
			filled.append(number)
		else:
			not_found.append(number)

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"company": company, "filled": sorted(filled), "not_found": sorted(not_found)}


def _can_manage_angola():
	roles = frappe.get_roles()
	return (
		"System Manager" in roles
		or "Accounts Manager" in roles
		or frappe.session.user == "Administrator"
	)


@frappe.whitelist()
def get_fiscal_years():
	"""Fiscal years, most recent first, for the statement year selector."""
	_assert_access()
	return frappe.get_all(
		"Fiscal Year",
		fields=["name", "year_start_date", "year_end_date"],
		order_by="year_start_date desc",
	)


@frappe.whitelist()
def get_angola_pl_config():
	"""Lightweight config for the front-end (is it set up + can the user manage it)."""
	_assert_access()
	doc = frappe.get_single(ANGOLA_PL_DOCTYPE)
	mapped = sum(1 for f in ANGOLA_ACCOUNT_FIELDS if doc.get(f))
	return {
		"enabled": cint(doc.enabled),
		"statement_title": doc.statement_title or ANGOLA_PL_TITLE,
		"default_company": doc.default_company or frappe.defaults.get_user_default("Company"),
		"default_fiscal_year": doc.default_fiscal_year,
		"mapped_accounts": mapped,
		"configured": 1 if mapped else 0,
		"can_manage": 1 if _can_manage_angola() else 0,
	}


def _fiscal_year_range(fiscal_year):
	row = frappe.db.get_value(
		"Fiscal Year", fiscal_year, ["year_start_date", "year_end_date"], as_dict=True
	)
	if not row:
		return None, None
	return getdate(row.year_start_date), getdate(row.year_end_date)


def _prev_fiscal_year_range(start, end):
	"""Previous comparable year: an actual prior Fiscal Year if one exists, else a year back."""
	prev = frappe.get_all(
		"Fiscal Year",
		filters={"year_end_date": ["<", start]},
		fields=["year_start_date", "year_end_date"],
		order_by="year_end_date desc",
		limit=1,
	)
	if prev:
		return getdate(prev[0].year_start_date), getdate(prev[0].year_end_date)
	return add_months(start, -12), add_months(end, -12)


def _account_credit_debit(account, start, end):
	"""(credit - debit) over an account's whole sub-tree for the period, plus root_type."""
	acc = frappe.db.get_value(
		"Account", account, ["lft", "rgt", "root_type", "company"], as_dict=True
	)
	if not acc:
		return None, None
	val = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(gle.credit - gle.debit), 0)
		FROM `tabGL Entry` gle
		INNER JOIN `tabAccount` a ON a.name = gle.account
		WHERE a.company = %(company)s
			AND a.lft >= %(lft)s AND a.rgt <= %(rgt)s
			AND gle.is_cancelled = 0
			AND gle.posting_date BETWEEN %(start)s AND %(end)s
		""",
		{"company": acc.company, "lft": acc.lft, "rgt": acc.rgt, "start": start, "end": end},
	)[0][0]
	return flt(val), acc.root_type


def _magnitude(account, start, end, missing):
	"""Positive value of an account: income => credit-debit, expense => debit-credit."""
	if not account:
		return 0.0
	cd, root_type = _account_credit_debit(account, start, end)
	if cd is None:
		missing.add(account)
		return 0.0
	if root_type in ("Income", "Liability", "Equity"):
		return cd
	return -cd


def _net(accounts, start, end, missing):
	"""Natural net (credit - debit) summed over one or two accounts (Proveitos - Custos)."""
	total = 0.0
	for account in accounts:
		if not account:
			continue
		cd, _root = _account_credit_debit(account, start, end)
		if cd is None:
			missing.add(account)
			continue
		total += cd
	return total


_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)


def _eval_formula(expr, values):
	"""Evaluate a fixed formula referencing row codes. Unknown names resolve to 0."""
	try:
		node = ast.parse(str(expr or "0"), mode="eval").body
	except SyntaxError:
		return 0.0

	def _ev(n):
		if isinstance(n, ast.BinOp) and isinstance(n.op, _ALLOWED_BINOPS):
			a, b = _ev(n.left), _ev(n.right)
			if isinstance(n.op, ast.Add):
				return a + b
			if isinstance(n.op, ast.Sub):
				return a - b
			if isinstance(n.op, ast.Mult):
				return a * b
			return a / b if b else 0.0
		if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
			v = _ev(n.operand)
			return -v if isinstance(n.op, ast.USub) else v
		if isinstance(n, ast.Name):
			return flt(values.get(n.id, 0.0))
		if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
			return float(n.value)
		raise ValueError("unsupported expression")

	try:
		return flt(_ev(node))
	except Exception:
		return 0.0


def _compute_column(doc, start, end, missing):
	"""Compute every row's value for one date range."""
	values = {}
	# Account-backed rows first.
	for line in ANGOLA_STATEMENT:
		if line["kind"] == "magnitude":
			values[line["code"]] = _magnitude(doc.get(line["field"]), start, end, missing)
		elif line["kind"] == "net":
			accounts = [doc.get(f) for f in line["fields"]]
			values[line["code"]] = _net(accounts, start, end, missing)
	# Formula rows in declaration order (totals build on earlier rows).
	for line in ANGOLA_STATEMENT:
		if line["kind"] == "formula":
			values[line["code"]] = _eval_formula(line["expr"], values)
	return values


@frappe.whitelist()
def get_angola_income_statement(fiscal_year=None, company=None):
	"""Compute the two-column (current + previous year) Cálculo de Lucros e Perdas."""
	_assert_access()

	doc = frappe.get_single(ANGOLA_PL_DOCTYPE)
	company = company or doc.default_company or frappe.defaults.get_user_default("Company")
	if not company:
		company = frappe.db.get_value("Company", {}, "name")
	fiscal_year = fiscal_year or doc.default_fiscal_year
	if not fiscal_year:
		fy = frappe.get_all("Fiscal Year", fields=["name"], order_by="year_start_date desc", limit=1)
		fiscal_year = fy[0].name if fy else None
	if not fiscal_year:
		frappe.throw(_("No Fiscal Year found. Create one first."))

	start, end = _fiscal_year_range(fiscal_year)
	prev_start, prev_end = _prev_fiscal_year_range(start, end)
	currency = _company_currency(company)

	missing = set()
	cur = _compute_column(doc, start, end, missing)
	prev = _compute_column(doc, prev_start, prev_end, set())

	rows = []
	for line in ANGOLA_STATEMENT:
		cur_v = flt(cur.get(line["code"]))
		prev_v = flt(prev.get(line["code"]))
		pol = "good_down" if line["code"] in PL_COST_CODES else "good_up"
		var, pct, status = _variation(cur_v, prev_v, pol)
		rows.append(
			{
				"row_code": line["code"],
				"label": line["label"],
				"notas": line.get("notas", ""),
				"line_type": "Formula" if line["kind"] == "formula" else "Account",
				"bold": cint(line.get("bold")),
				"indent": 0,
				"current": cur_v,
				"previous": prev_v,
				"variation": var,
				"variation_pct": pct,
				"status": status,
			}
		)

	return {
		"title": doc.statement_title or ANGOLA_PL_TITLE,
		"company": company,
		"currency": currency,
		"fiscal_year": fiscal_year,
		"current_label": getdate(end).year if end else "",
		"previous_label": getdate(prev_end).year if prev_end else "",
		"current_range": [str(start), str(end)] if start else None,
		"previous_range": [str(prev_start), str(prev_end)] if prev_start else None,
		"rows": rows,
		"missing_accounts": sorted(missing),
		"can_manage": 1 if _can_manage_angola() else 0,
	}


# --------------------------------------------------------------------------- #
# Angola balance sheet — Balanço
# --------------------------------------------------------------------------- #
#
# Same pattern as the income statement: structure/labels/notes/totals are fixed
# in code; only the account per line is configured (searchable Link fields).
#
# Columns (current year): Valor bruto | Amortizações | Valor líquido
# (previous year): Valor líquido.  Valor líquido = Valor bruto − Amortizações.
#
# Line kinds:
#   asset      : one asset account. bruto = líquido = debit-credit; amort = 0.
#   asset_dep  : gross + accumulated-depreciation accounts. bruto = gross value,
#                amort = accumulated depreciation, líquido = bruto - amort.
#   liab       : one equity/liability account. líquido = credit-debit; no bruto/amort.
#   pl_result  : Resultados do Exercício — the net result from the P&L for the year.
#   total      : sum of member rows per column.
#   header/subheader : section titles only.

ANGOLA_BS_DOCTYPE = "Isoft Angola Balance Sheet Settings"
ANGOLA_BS_TITLE = "Balanço (Balance)"

ANGOLA_BS = [
	{"code": "h_activo", "label": "ACTIVO", "kind": "header"},
	{"code": "h_anc", "label": "Activo não corrente", "kind": "subheader"},
	{"code": "imob_corp", "label": "Imobilizações corpóreas", "notas": "4", "kind": "asset_dep", "field": "bs_imob_corp", "amort_field": "bs_imob_corp_amort"},
	{"code": "imob_incorp", "label": "Imobilizações incorpóreas", "notas": "5", "kind": "asset_dep", "field": "bs_imob_incorp", "amort_field": "bs_imob_incorp_amort"},
	{"code": "investimentos", "label": "Investimentos em subsidiárias e associadas", "notas": "6", "kind": "asset", "field": "bs_investimentos"},
	{"code": "outros_ativos_fin", "label": "Outros activos financeiros", "notas": "7", "kind": "asset", "field": "bs_outros_ativos_fin"},
	{"code": "outros_ativos_nao_corr", "label": "Outros activos não correntes", "notas": "", "kind": "asset", "field": "bs_outros_ativos_nao_corr"},
	{"code": "total_anc", "label": "TOTAL DO ACTIVO NÃO CORRENTE", "kind": "total", "members": ["imob_corp", "imob_incorp", "investimentos", "outros_ativos_fin", "outros_ativos_nao_corr"], "bold": 1},
	{"code": "h_ac", "label": "Activo corrente", "kind": "subheader"},
	{"code": "existencias", "label": "Existências", "notas": "8", "kind": "asset", "field": "bs_existencias"},
	{"code": "contas_receber", "label": "Contas a receber", "notas": "9", "kind": "asset", "field": "bs_contas_receber"},
	{"code": "disponibilidades", "label": "Disponibilidades", "notas": "10", "kind": "asset", "field": "bs_disponibilidades"},
	{"code": "outros_ativos_corr", "label": "Outros activos correntes", "notas": "11", "kind": "asset", "field": "bs_outros_ativos_corr"},
	{"code": "total_ac", "label": "TOTAL DO ACTIVO CORRENTE", "kind": "total", "members": ["existencias", "contas_receber", "disponibilidades", "outros_ativos_corr"], "bold": 1},
	{"code": "total_activo", "label": "TOTAL DO ACTIVO", "kind": "total", "members": ["total_anc", "total_ac"], "bold": 1, "strong": 1},

	{"code": "h_cpp", "label": "CAPITAL PRÓPRIO E PASSIVO", "kind": "header"},
	{"code": "h_cp", "label": "Capital Próprio", "kind": "subheader"},
	{"code": "capital", "label": "Capital", "notas": "12", "kind": "liab", "field": "bs_capital"},
	{"code": "prest_supl", "label": "Prestações suplementares", "notas": "12", "kind": "liab", "field": "bs_prest_supl"},
	{"code": "reservas", "label": "Reservas", "notas": "13", "kind": "liab", "field": "bs_reservas"},
	{"code": "res_transitados", "label": "Resultados Transitados", "notas": "14", "kind": "liab", "field": "bs_res_transitados"},
	{"code": "res_exercicio", "label": "Resultados do Exercício", "notas": "", "kind": "pl_result"},
	{"code": "total_cp", "label": "TOTAL DO CAPITAL PRÓPRIO", "kind": "total", "members": ["capital", "prest_supl", "reservas", "res_transitados", "res_exercicio"], "bold": 1},
	{"code": "h_pnc", "label": "Passivo não corrente", "kind": "subheader"},
	{"code": "emprestimos_mlp", "label": "Empréstimos de médio e longo prazo", "notas": "15", "kind": "liab", "field": "bs_emprestimos_mlp"},
	{"code": "impostos_diferidos", "label": "Impostos diferidos", "notas": "16", "kind": "liab", "field": "bs_impostos_diferidos"},
	{"code": "prov_clientes", "label": "Provisões para Clientes de Cobrança Duvidosa", "notas": "17", "kind": "liab", "field": "bs_prov_clientes"},
	{"code": "prov_riscos", "label": "Provisões para outros riscos e encargos", "notas": "18", "kind": "liab", "field": "bs_prov_riscos"},
	{"code": "outros_passivos_nao_corr", "label": "Outros passivos não correntes", "notas": "19", "kind": "liab", "field": "bs_outros_passivos_nao_corr"},
	{"code": "total_pnc", "label": "TOTAL DO PASSIVO NÃO CORRENTE", "kind": "total", "members": ["emprestimos_mlp", "impostos_diferidos", "prov_clientes", "prov_riscos", "outros_passivos_nao_corr"], "bold": 1},
	{"code": "h_pc", "label": "Passivo corrente", "kind": "subheader"},
	{"code": "contas_pagar", "label": "Contas a pagar", "notas": "19", "kind": "liab", "field": "bs_contas_pagar"},
	{"code": "emprestimos_cp", "label": "Empréstimos de curto prazo", "notas": "20", "kind": "liab", "field": "bs_emprestimos_cp"},
	{"code": "parte_corr_mlp", "label": "Parte corrente de empréstimos a m/l prazo", "notas": "", "kind": "liab", "field": "bs_parte_corr_mlp"},
	{"code": "outros_passivos_corr", "label": "Outros passivos correntes", "notas": "21", "kind": "liab", "field": "bs_outros_passivos_corr"},
	{"code": "total_pc", "label": "TOTAL DO PASSIVO CORRENTE", "kind": "total", "members": ["contas_pagar", "emprestimos_cp", "parte_corr_mlp", "outros_passivos_corr"], "bold": 1},
	{"code": "total_cpp", "label": "TOTAL DO CAPITAL PRÓPRIO E PASSIVO", "kind": "total", "members": ["total_cp", "total_pnc", "total_pc"], "bold": 1, "strong": 1},
]

# Lines that are liabilities — a HIGHER balance is unfavorable (drives variation colour).
BS_LIABILITY_CODES = {
	"emprestimos_mlp", "impostos_diferidos", "prov_clientes", "prov_riscos", "outros_passivos_nao_corr",
	"total_pnc", "contas_pagar", "emprestimos_cp", "parte_corr_mlp", "outros_passivos_corr", "total_pc",
}

ANGOLA_BS_ACCOUNT_FIELDS = [
	"bs_imob_corp", "bs_imob_corp_amort", "bs_imob_incorp", "bs_imob_incorp_amort",
	"bs_investimentos", "bs_outros_ativos_fin", "bs_outros_ativos_nao_corr",
	"bs_existencias", "bs_contas_receber", "bs_disponibilidades", "bs_outros_ativos_corr",
	"bs_capital", "bs_prest_supl", "bs_reservas", "bs_res_transitados",
	"bs_emprestimos_mlp", "bs_impostos_diferidos", "bs_prov_clientes", "bs_prov_riscos", "bs_outros_passivos_nao_corr",
	"bs_contas_pagar", "bs_emprestimos_cp", "bs_parte_corr_mlp", "bs_outros_passivos_corr",
]

# Best-effort PGC-A mapping (ITEC chart). None = map manually.
ANGOLA_BS_STANDARD_NUMBERS = {
	"bs_imob_corp": "11",
	"bs_imob_corp_amort": None,
	"bs_imob_incorp": "12",
	"bs_imob_incorp_amort": None,
	"bs_investimentos": None,
	"bs_outros_ativos_fin": None,
	"bs_outros_ativos_nao_corr": None,
	"bs_existencias": "2",
	"bs_contas_receber": "31",
	"bs_disponibilidades": "4",
	"bs_outros_ativos_corr": None,
	"bs_capital": "5",
	"bs_prest_supl": None,
	"bs_reservas": None,
	"bs_res_transitados": "81",
	"bs_emprestimos_mlp": None,
	"bs_impostos_diferidos": "34",
	"bs_prov_clientes": None,
	"bs_prov_riscos": None,
	"bs_outros_passivos_nao_corr": None,
	"bs_contas_pagar": "32",
	"bs_emprestimos_cp": "33",
	"bs_parte_corr_mlp": None,
	"bs_outros_passivos_corr": "37",
}


@frappe.whitelist()
def automap_balance_sheet_accounts(overwrite=0):
	"""Fill each Balanço account field from its standard PGC-A number in the company's chart."""
	if not _can_manage_angola():
		frappe.throw(_("Only an Accounts / System Manager can map the accounts."), frappe.PermissionError)

	doc = frappe.get_single(ANGOLA_BS_DOCTYPE)
	company = doc.default_company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Set the Company first, then map the standard accounts."))

	overwrite = cint(overwrite)
	filled, not_found = [], []
	for field, number in ANGOLA_BS_STANDARD_NUMBERS.items():
		if not number:
			continue
		if doc.get(field) and not overwrite:
			continue
		account = frappe.db.get_value("Account", {"account_number": number, "company": company}, "name")
		if account:
			doc.set(field, account)
			filled.append(number)
		else:
			not_found.append(number)

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"company": company, "filled": sorted(filled), "not_found": sorted(not_found)}


@frappe.whitelist()
def get_balance_sheet_config():
	_assert_access()
	doc = frappe.get_single(ANGOLA_BS_DOCTYPE)
	mapped = sum(1 for f in ANGOLA_BS_ACCOUNT_FIELDS if doc.get(f))
	return {
		"enabled": cint(doc.enabled),
		"statement_title": doc.statement_title or ANGOLA_BS_TITLE,
		"default_company": doc.default_company or frappe.defaults.get_user_default("Company"),
		"default_fiscal_year": doc.default_fiscal_year,
		"mapped_accounts": mapped,
		"configured": 1 if mapped else 0,
		"can_manage": 1 if _can_manage_angola() else 0,
	}


def _pl_net_result(start, end):
	"""Resultados do Exercício = the P&L net result (res_liq_exercicio) for the period."""
	try:
		pl = frappe.get_single(ANGOLA_PL_DOCTYPE)
		vals = _compute_column(pl, start, end, set())
		return flt(vals.get("res_liq_exercicio", 0.0))
	except Exception:
		return 0.0


def _bs_line_values(line, doc, start, end, missing):
	"""Return (bruto, amort, liquido) for one line; None means 'not applicable'."""
	kind = line["kind"]

	if kind == "asset":
		acc = doc.get(line["field"])
		if not acc:
			return (0.0, 0.0, 0.0)
		cd, _root = _account_credit_debit(acc, start, end)
		if cd is None:
			missing.add(acc)
			return (0.0, 0.0, 0.0)
		liq = -cd  # debit - credit
		return (liq, 0.0, liq)

	if kind == "asset_dep":
		bruto = amort = 0.0
		gross = doc.get(line["field"])
		if gross:
			cd, _r = _account_credit_debit(gross, start, end)
			if cd is None:
				missing.add(gross)
			else:
				bruto = -cd  # debit - credit (gross cost)
		dep = doc.get(line.get("amort_field"))
		if dep:
			cd, _r = _account_credit_debit(dep, start, end)
			if cd is None:
				missing.add(dep)
			else:
				amort = cd  # credit - debit (accumulated depreciation, shown positive)
		return (bruto, amort, bruto - amort)

	if kind == "liab":
		acc = doc.get(line["field"])
		if not acc:
			return (None, None, 0.0)
		cd, _root = _account_credit_debit(acc, start, end)
		if cd is None:
			missing.add(acc)
			return (None, None, 0.0)
		return (None, None, cd)  # credit - debit

	if kind == "pl_result":
		return (None, None, _pl_net_result(start, end))

	return (None, None, None)  # header / subheader


def _bs_total(members, results):
	bruto = amort = liquido = 0.0
	any_b = any_a = False
	for m in members:
		rb, ra, rl = results[m]
		if rb is not None:
			bruto += rb
			any_b = True
		if ra is not None:
			amort += ra
			any_a = True
		if rl is not None:
			liquido += rl
	return (bruto if any_b else None, amort if any_a else None, liquido)


def _bs_compute(doc, start, end, missing):
	results = {}
	for line in ANGOLA_BS:
		if line["kind"] == "total":
			results[line["code"]] = _bs_total(line["members"], results)
		else:
			results[line["code"]] = _bs_line_values(line, doc, start, end, missing)
	return results


@frappe.whitelist()
def get_angola_balance_sheet(fiscal_year=None, company=None):
	"""Compute the Balanço: current year (bruto/amort/líquido) + previous year (líquido)."""
	_assert_access()

	doc = frappe.get_single(ANGOLA_BS_DOCTYPE)
	company = company or doc.default_company or frappe.defaults.get_user_default("Company")
	if not company:
		company = frappe.db.get_value("Company", {}, "name")
	fiscal_year = fiscal_year or doc.default_fiscal_year
	if not fiscal_year:
		fy = frappe.get_all("Fiscal Year", fields=["name"], order_by="year_start_date desc", limit=1)
		fiscal_year = fy[0].name if fy else None
	if not fiscal_year:
		frappe.throw(_("No Fiscal Year found. Create one first."))

	start, end = _fiscal_year_range(fiscal_year)
	prev_start, prev_end = _prev_fiscal_year_range(start, end)
	currency = _company_currency(company)

	missing = set()
	cur = _bs_compute(doc, start, end, missing)
	prev = _bs_compute(doc, prev_start, prev_end, set())

	rows = []
	for line in ANGOLA_BS:
		cb, ca, cl = cur[line["code"]]
		_pb, _pa, pl = prev[line["code"]]
		is_header = line["kind"] in ("header", "subheader")
		# Liabilities: a higher balance is unfavorable; assets & equity: higher is favorable.
		pol = "good_down" if line["code"] in BS_LIABILITY_CODES else "good_up"
		var, pct, status = (None, None, None)
		if not is_header:
			var, pct, status = _variation(cl, pl, pol)
		rows.append(
			{
				"row_code": line["code"],
				"label": line["label"],
				"notas": line.get("notas", ""),
				"kind": line["kind"],
				"is_header": 1 if is_header else 0,
				"bold": cint(line.get("bold")),
				"strong": cint(line.get("strong")),
				"bruto": None if is_header else cb,
				"amort": None if is_header else ca,
				"liquido": None if is_header else cl,
				"liquido_prev": None if is_header else pl,
				"variation": var,
				"variation_pct": pct,
				"status": status,
			}
		)

	total_activo = cur["total_activo"][2]
	total_cpp = cur["total_cpp"][2]
	return {
		"title": doc.statement_title or ANGOLA_BS_TITLE,
		"company": company,
		"currency": currency,
		"fiscal_year": fiscal_year,
		"current_label": getdate(end).year if end else "",
		"previous_label": getdate(prev_end).year if prev_end else "",
		"rows": rows,
		"missing_accounts": sorted(missing),
		"total_activo": total_activo,
		"total_cpp": total_cpp,
		"balanced": abs(flt(total_activo) - flt(total_cpp)) < 1.0,
		"difference": flt(total_activo) - flt(total_cpp),
		"can_manage": 1 if _can_manage_angola() else 0,
	}


# --------------------------------------------------------------------------- #
# Settings modal endpoints (used by the in-app custom modal, not the doctype form)
# --------------------------------------------------------------------------- #
@frappe.whitelist()
def get_angola_pl_settings():
	"""Current account mappings for the P&L, for the settings modal."""
	_assert_access()
	doc = frappe.get_single(ANGOLA_PL_DOCTYPE)
	data = {
		"default_company": doc.default_company or frappe.defaults.get_user_default("Company"),
		"default_fiscal_year": doc.default_fiscal_year,
		"statement_title": doc.statement_title or ANGOLA_PL_TITLE,
		"can_manage": 1 if _can_manage_angola() else 0,
	}
	for f in ANGOLA_ACCOUNT_FIELDS:
		data[f] = doc.get(f)
	return data


@frappe.whitelist()
def save_angola_pl_settings(payload):
	"""Save the P&L account mappings from the settings modal."""
	if not _can_manage_angola():
		frappe.throw(_("Only an Accounts / System Manager can change these settings."), frappe.PermissionError)
	if isinstance(payload, str):
		payload = frappe.parse_json(payload)
	payload = payload or {}
	doc = frappe.get_single(ANGOLA_PL_DOCTYPE)
	for f in ["default_company", "default_fiscal_year"] + ANGOLA_ACCOUNT_FIELDS:
		if f in payload:
			doc.set(f, payload.get(f) or None)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return get_angola_pl_settings()


@frappe.whitelist()
def get_balance_sheet_settings():
	"""Current account mappings for the Balanço, for the settings modal."""
	_assert_access()
	doc = frappe.get_single(ANGOLA_BS_DOCTYPE)
	data = {
		"default_company": doc.default_company or frappe.defaults.get_user_default("Company"),
		"default_fiscal_year": doc.default_fiscal_year,
		"statement_title": doc.statement_title or ANGOLA_BS_TITLE,
		"can_manage": 1 if _can_manage_angola() else 0,
	}
	for f in ANGOLA_BS_ACCOUNT_FIELDS:
		data[f] = doc.get(f)
	return data


@frappe.whitelist()
def save_balance_sheet_settings(payload):
	"""Save the Balanço account mappings from the settings modal."""
	if not _can_manage_angola():
		frappe.throw(_("Only an Accounts / System Manager can change these settings."), frappe.PermissionError)
	if isinstance(payload, str):
		payload = frappe.parse_json(payload)
	payload = payload or {}
	doc = frappe.get_single(ANGOLA_BS_DOCTYPE)
	for f in ["default_company", "default_fiscal_year"] + ANGOLA_BS_ACCOUNT_FIELDS:
		if f in payload:
			doc.set(f, payload.get(f) or None)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return get_balance_sheet_settings()


@frappe.whitelist()
def resolve_standard_accounts(report, company):
	"""Resolve standard PGC-A numbers to accounts in the company (WITHOUT saving).
	Used by the modal's 'Auto-fill' button to populate fields for review."""
	_assert_access()
	mapping = ANGOLA_STANDARD_NUMBERS if report == "pl" else ANGOLA_BS_STANDARD_NUMBERS
	accounts, not_found = {}, []
	for field, number in mapping.items():
		if not number:
			continue
		account = frappe.db.get_value("Account", {"account_number": number, "company": company}, "name")
		if account:
			accounts[field] = account
		else:
			not_found.append(number)
	return {"accounts": accounts, "not_found": sorted(not_found)}
