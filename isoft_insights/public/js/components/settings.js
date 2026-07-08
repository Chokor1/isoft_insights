// Isoft Insights - Settings: editable in-app configuration incl. access management.
frappe.provide('isoft_insights.views');

isoft_insights.util = isoft_insights.util || {
	esc: (s) => frappe.utils.escape_html(s == null ? '' : String(s)),
	empty: (msg) => `<div class="ii-empty"><i class="fa fa-inbox"></i>${msg || 'No data.'}</div>`
};

isoft_insights.views.settings = function (ctx) {
	const esc = isoft_insights.util.esc;

	Promise.all([
		ctx.api('get_insights_settings'),
		ctx.api('get_roles_list').catch(() => []),
		ctx.api('get_companies').catch(() => [])
	]).then(([s, roles, companies]) => {
		ctx.state.settings = s || {};
		const manage = !!s.can_manage;
		const dis = manage ? '' : 'disabled';
		const allowedRoles = new Set(s.allowed_roles || []);
		const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;

		const companyOpts = ['<option value="">All Companies</option>']
			.concat((companies || []).map((c) => opt(c, c, s.default_company))).join('');
		const periodOpts = ['This Month', 'This Quarter', 'This Year', 'Last 12 Months', 'All Time']
			.map((p) => opt(p, p, s.default_period)).join('');
		const roleChecks = (roles || []).map((r) => `
			<label class="ii-role-chip ${allowedRoles.has(r) ? 'on' : ''}">
				<input type="checkbox" value="${esc(r)}" ${allowedRoles.has(r) ? 'checked' : ''} ${dis}> ${esc(r)}
			</label>`).join('') || '<span style="color:var(--ii-muted)">No roles found.</span>';

		ctx.$content.html(`
			<div class="ii-card">
				<div class="ii-card-title"><i class="fa fa-lock"></i> Access Control
					<span class="ii-pill">${manage ? 'You can edit' : 'Read only — System Manager required'}</span>
				</div>
				<div class="ii-settings-grid">
					<div>
						<span class="ii-field-label">Access Mode</span>
						<select class="form-control" id="s-access-mode" ${dis}>
							${opt('By Role', 'By Role', s.access_mode)}${opt('By User', 'By User', s.access_mode)}
						</select>
					</div>
				</div>
				<div id="s-roles-wrap" style="margin-top:14px;${s.access_mode === 'By User' ? 'display:none;' : ''}">
					<span class="ii-field-label">Allowed Roles <small style="color:var(--ii-muted)">(System Manager always has access)</small></span>
					<div class="ii-role-grid" id="s-roles">${roleChecks}</div>
				</div>
				<div id="s-users-wrap" style="margin-top:14px;${s.access_mode === 'By User' ? '' : 'display:none;'}">
					<span class="ii-field-label">Allowed Users <small style="color:var(--ii-muted)">(one email per line)</small></span>
					<textarea class="form-control" id="s-users" rows="4" ${dis}>${esc((s.allowed_users || []).join('\n'))}</textarea>
				</div>
			</div>

			<div class="ii-card">
				<div class="ii-card-title"><i class="fa fa-sliders"></i> Preferences</div>
				<div class="ii-settings-grid">
					<div><span class="ii-field-label">Default Company</span><select class="form-control" id="s-company" ${dis}>${companyOpts}</select></div>
					<div><span class="ii-field-label">Display Currency</span><input class="form-control" id="s-currency" value="${esc(s.default_currency || '')}" ${dis}></div>
					<div><span class="ii-field-label">Default Period</span><select class="form-control" id="s-period" ${dis}>${periodOpts}</select></div>
					<div><span class="ii-field-label">Top N (lists)</span><input type="number" min="1" class="form-control" id="s-topn" value="${esc(s.top_n)}" ${dis}></div>
				</div>
				${manage ? `<div style="margin-top:18px;"><button class="btn btn-primary" id="s-save"><i class="fa fa-save"></i> Save settings</button>
					<button class="btn btn-default" id="s-openform" style="margin-left:8px;"><i class="fa fa-external-link"></i> Open full form</button></div>` :
					'<div style="margin-top:14px;color:var(--ii-muted);font-size:12px;">Only a System Manager can edit these settings.</div>'}
			</div>
		`);

		ctx.$content.find('#s-access-mode').on('change', function () {
			const byUser = $(this).val() === 'By User';
			ctx.$content.find('#s-roles-wrap').toggle(!byUser);
			ctx.$content.find('#s-users-wrap').toggle(byUser);
		});
		ctx.$content.find('.ii-role-chip input').on('change', function () {
			$(this).closest('.ii-role-chip').toggleClass('on', $(this).prop('checked'));
		});
		ctx.$content.find('#s-openform').on('click', () => frappe.set_route('Form', 'Isoft Insights Settings'));

		ctx.$content.find('#s-save').on('click', function () {
			const selectedRoles = ctx.$content.find('.ii-role-chip input:checked').map(function () { return $(this).val(); }).get();
			const payload = {
				access_mode: ctx.$content.find('#s-access-mode').val(),
				allowed_roles: selectedRoles,
				allowed_users: ctx.$content.find('#s-users').val(),
				default_company: ctx.$content.find('#s-company').val(),
				default_currency: ctx.$content.find('#s-currency').val(),
				default_period: ctx.$content.find('#s-period').val(),
				top_n: cint(ctx.$content.find('#s-topn').val()) || 10
			};
			const $btn = $(this).prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Saving…');
			ctx.api('save_insights_settings', { payload: JSON.stringify(payload) }).then((res) => {
				ctx.state.settings = res || ctx.state.settings;
				ctx.app.state.currency = res.default_currency || ctx.app.state.currency;
				frappe.show_alert({ message: 'Isoft Insights settings saved', indicator: 'green' });
				$btn.prop('disabled', false).html('<i class="fa fa-save"></i> Save settings');
			}).catch(() => {
				frappe.show_alert({ message: 'Could not save settings', indicator: 'red' });
				$btn.prop('disabled', false).html('<i class="fa fa-save"></i> Save settings');
			});
		});
	}).catch(() => ctx.$content.html(isoft_insights.util.empty('Could not load settings.')));
};
