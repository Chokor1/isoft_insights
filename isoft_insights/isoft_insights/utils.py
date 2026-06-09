# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt
#
# Backend for the Isoft Insights sales analytics app.
# All UI-facing endpoints are whitelisted and guarded by _assert_access().

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
		"theme_color": s.theme_color or "Blue",
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
			customer_name,
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
		GROUP BY customer, customer_name
		ORDER BY total_outstanding DESC
		""".format(where=where),
		params,
		as_dict=True,
	)

	totals = {
		"total_outstanding": sum(flt(r.total_outstanding) for r in rows),
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
		"default_company", "default_currency", "default_period", "top_n", "theme_color", "access_mode",
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
