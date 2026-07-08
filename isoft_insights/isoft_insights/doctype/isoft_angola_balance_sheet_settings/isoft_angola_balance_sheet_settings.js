// Copyright (c) 2026, Isoft and contributors
// For license information, please see license.txt

const BS_ACCOUNT_FIELDS = [
	"bs_imob_corp", "bs_imob_corp_amort", "bs_imob_incorp", "bs_imob_incorp_amort",
	"bs_investimentos", "bs_outros_ativos_fin", "bs_outros_ativos_nao_corr",
	"bs_existencias", "bs_contas_receber", "bs_disponibilidades", "bs_outros_ativos_corr",
	"bs_capital", "bs_prest_supl", "bs_reservas", "bs_res_transitados",
	"bs_emprestimos_mlp", "bs_impostos_diferidos", "bs_prov_clientes", "bs_prov_riscos", "bs_outros_passivos_nao_corr",
	"bs_contas_pagar", "bs_emprestimos_cp", "bs_parte_corr_mlp", "bs_outros_passivos_corr",
];

frappe.ui.form.on("Isoft Angola Balance Sheet Settings", {
	refresh(frm) {
		set_account_queries(frm);
		frm.add_custom_button(__("Auto-fill Standard Accounts"), () => auto_fill(frm));
		frm.add_custom_button(__("Open Balanço"), () => frappe.set_route("isoft-insights"));
	},

	default_company(frm) {
		set_account_queries(frm);
	},
});

function set_account_queries(frm) {
	const company = frm.doc.default_company;
	BS_ACCOUNT_FIELDS.forEach((field) => {
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
			method: "isoft_insights.isoft_insights.utils.automap_balance_sheet_accounts",
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

	const hasValues = BS_ACCOUNT_FIELDS.some((f) => frm.doc[f]);
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
