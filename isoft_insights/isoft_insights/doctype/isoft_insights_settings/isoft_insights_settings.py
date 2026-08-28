# Copyright (c) 2026, Isoft and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from isoft_insights.isoft_insights.utils import normalize_access_list


class IsoftInsightsSettings(Document):
	def validate(self):
		# Always store one entry per line, whatever separator was typed or
		# pasted into the field, so a literal <br> can never be read back as
		# part of a role or user name.
		self.allowed_roles = "\n".join(normalize_access_list(self.allowed_roles))
		self.allowed_users = "\n".join(normalize_access_list(self.allowed_users))

	def on_update(self):
		# The access lists are read from this Single on every request, so drop
		# the cache to make a change take effect without a re-login.
		frappe.clear_cache()
