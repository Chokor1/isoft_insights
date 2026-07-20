// Copyright (c) 2026, Isoft and contributors
// For license information, please see license.txt

const CF_ACCOUNT_FIELDS = [
	"cf_receb_clientes", "cf_pag_fornecedores", "cf_pag_pessoal", "cf_imposto_rendimento", "cf_outro_receb_pag",
	"cf_inv_pag_tangiveis", "cf_inv_pag_intangiveis", "cf_inv_pag_financeiros", "cf_inv_pag_outros",
	"cf_inv_receb_tangiveis", "cf_inv_receb_intangiveis", "cf_inv_receb_financeiros", "cf_inv_receb_outros",
	"cf_inv_subsidios", "cf_inv_juros", "cf_inv_dividendos",
	"cf_fin_receb_financiamentos", "cf_fin_receb_capital", "cf_fin_receb_cobertura", "cf_fin_receb_doacoes", "cf_fin_receb_outras",
	"cf_fin_pag_financiamentos", "cf_fin_pag_juros", "cf_fin_pag_dividendos", "cf_fin_pag_reducoes", "cf_fin_pag_outras",
	"cf_caixa", "cf_efeito_cambio",
];

frappe.ui.form.on("Isoft Angola Cash Flow Settings", {
	refresh(frm) {
		set_account_queries(frm);
		frm.add_custom_button(__("Auto-fill Standard Accounts"), () => auto_fill(frm));
		frm.add_custom_button(__("Open Fluxos de Caixa"), () => frappe.set_route("isoft-insights"));
	},
	default_company(frm) {
		set_account_queries(frm);
	},
});

function set_account_queries(frm) {
	const company = frm.doc.default_company;
	CF_ACCOUNT_FIELDS.forEach((field) => {
		frm.set_query(field, () => ({ filters: company ? { company } : {} }));
	});
}

function auto_fill(frm) {
	if (!frm.doc.default_company) {
		frappe.msgprint(__("Set the Company first, then map the standard accounts."));
		return;
	}
	const run = (overwrite) =>
		frappe.call({
			method: "isoft_insights.isoft_insights.utils.automap_cash_flow_accounts",
			args: { overwrite: overwrite ? 1 : 0 },
			freeze: true,
			freeze_message: __("Matching standard accounts…"),
			callback: (r) => {
				const res = r.message || {};
				frm.reload_doc();
				let msg = __("Filled: {0}", [(res.filled || []).join(", ") || "—"]);
				if ((res.not_found || []).length) {
					msg += "<br>" + __("Not found in {0}: {1}", [res.company, res.not_found.join(", ")]);
				}
				frappe.msgprint({ title: __("Standard Accounts"), message: msg, indicator: "blue" });
			},
		});

	if (CF_ACCOUNT_FIELDS.some((f) => frm.doc[f])) {
		frappe.confirm(
			__("Overwrite the accounts you already picked with the standard ones? Choose No to fill only the empty fields."),
			() => run(true),
			() => run(false)
		);
	} else {
		run(false);
	}
}
