// Copyright (c) 2026, Isoft and contributors
// For license information, please see license.txt

const ANGOLA_ACCOUNT_FIELDS = [
	"acc_vendas", "acc_servicos", "acc_outros_prov_op",
	"acc_variacoes", "acc_trabalhos", "acc_cmvmc",
	"acc_custos_pessoal", "acc_amortizacoes", "acc_outros_custos_op",
	"acc_fin_proveitos", "acc_fin_custos", "acc_res_filiais",
	"acc_naoop_proveitos", "acc_naoop_custos",
	"acc_impostos_rendimento", "acc_imposto_rend_extra",
	"acc_extra_proveitos", "acc_extra_custos",
];

frappe.ui.form.on("Isoft Angola Income Statement Settings", {
	refresh(frm) {
		set_account_queries(frm);

		frm.add_custom_button(__("Auto-fill Standard Accounts"), () => auto_fill(frm));
		frm.add_custom_button(__("Open Statement"), () => frappe.set_route("isoft-insights"));
	},

	default_company(frm) {
		// Company changed → re-scope the account pickers.
		set_account_queries(frm);
	},
});

function auto_fill(frm) {
	if (!frm.doc.default_company) {
		frappe.msgprint(__("Set the Company first, then map the standard accounts."));
		return;
	}
	const run = (overwrite) =>
		frappe.call({
			method: "isoft_insights.isoft_insights.utils.automap_angola_accounts",
			args: { overwrite: overwrite ? 1 : 0 },
			freeze: true,
			freeze_message: __("Matching standard accounts…"),
			callback: (r) => {
				const res = r.message || {};
				frm.reload_doc();
				let msg = __("Filled accounts: {0}", [(res.filled || []).join(", ") || "—"]);
				if ((res.not_found || []).length) {
					msg += "<br>" + __("Not found in {0}: {1}", [res.company, res.not_found.join(", ")]);
				}
				frappe.msgprint({ title: __("Standard Accounts"), message: msg, indicator: "blue" });
			},
		});

	// Keep any accounts the user already picked; offer to overwrite if some are set.
	const hasValues = [
		"acc_vendas", "acc_servicos", "acc_outros_prov_op", "acc_variacoes", "acc_trabalhos",
		"acc_cmvmc", "acc_custos_pessoal", "acc_amortizacoes", "acc_outros_custos_op",
		"acc_fin_proveitos", "acc_fin_custos", "acc_naoop_proveitos", "acc_naoop_custos",
		"acc_impostos_rendimento", "acc_extra_proveitos", "acc_extra_custos",
	].some((f) => frm.doc[f]);

	if (hasValues) {
		frappe.confirm(
			__("Overwrite the accounts you already picked with the standard ones? Choose No to fill only the empty fields."),
			() => run(true),
			() => run(false)
		);
	} else {
		run(false);
	}
}

function set_account_queries(frm) {
	const company = frm.doc.default_company;
	ANGOLA_ACCOUNT_FIELDS.forEach((field) => {
		frm.set_query(field, () => ({
			filters: company ? { company } : {},
		}));
	});
}
