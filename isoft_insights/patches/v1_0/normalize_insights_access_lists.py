# Rewrite the Isoft Insights access lists as one entry per line.
#
# Values saved before the tolerant parser could hold literal <br> tags instead
# of newlines, which made the role check match nobody and left only
# Administrator able to open Insights. No-op when the value is already clean.

import frappe

from isoft_insights.isoft_insights.utils import SETTINGS_DOCTYPE, normalize_access_list


def execute():
	if not frappe.db.exists("DocType", SETTINGS_DOCTYPE):
		return

	for field in ("allowed_roles", "allowed_users"):
		current = frappe.db.get_single_value(SETTINGS_DOCTYPE, field)
		cleaned = "\n".join(normalize_access_list(current))
		if cleaned != (current or ""):
			frappe.db.set_single_value(SETTINGS_DOCTYPE, field, cleaned)
