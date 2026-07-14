// Isoft Insights Icon - navbar shortcut to the Sales Analytics dashboard.
// Shown only to users allowed by Isoft Insights Settings. Opens in a new tab.
(function () {
	'use strict';

	function initInsightsIcon() {
		if (document.getElementById('isoft-insights-navbar')) return;

		frappe.call({
			method: 'isoft_insights.isoft_insights.utils.can_access_insights',
			callback: function (r) {
				if (!r || !r.message) return; // no access -> no icon
				if (document.getElementById('isoft-insights-navbar')) return;

				// NOTE: inline onclick is required. Frappe's router intercepts <a>
				// clicks and routes /app/* links in the same tab; it only skips
				// links that already have an onclick attribute.
				const icon = `
					<li class='nav-item dropdown dropdown-notifications dropdown-mobile insights-icon' title="Isoft Insights - Sales &amp; Purchase" aria-label="Isoft Insights">
						<a href="/app/isoft-insights" class="insights-button" id="isoft-insights-navbar" target="_blank" rel="noopener"
							onclick="window.open('/app/isoft-insights', '_blank'); return false;">
							<i class="fa fa-line-chart"></i>
						</a>
					</li>`;

				const $list = $('header.navbar > .container > .navbar-collapse > ul');
				if ($list.length) $list.prepend(icon);

				if (!document.getElementById('isoft-insights-icon-styles')) {
					$('head').append(`
						<style id="isoft-insights-icon-styles">
							.insights-icon { margin-right: 8px; }
							.insights-button {
								display: flex; align-items: center; justify-content: center;
								width: 40px; height: 40px;
								background: linear-gradient(135deg, #818cf8 0%, #4338ca 100%);
								color: #fff; text-decoration: none; border-radius: 50%;
								transition: all 0.3s ease;
								box-shadow: 0 2px 8px rgba(67, 56, 202, 0.45);
								position: relative; overflow: hidden; cursor: pointer;
							}
							.insights-button:hover {
								background: linear-gradient(135deg, #6366f1 0%, #3730a3 100%);
								color: #fff; text-decoration: none;
								transform: translateY(-2px) scale(1.05);
								box-shadow: 0 4px 16px rgba(67, 56, 202, 0.55);
							}
							.insights-button:active { transform: translateY(0) scale(0.98); }
							.insights-button i { color: #fff; font-size: 18px; text-shadow: 0 1px 2px rgba(0,0,0,0.2); }
							.insights-button::before {
								content: ''; position: absolute; top: 0; left: -100%;
								width: 100%; height: 100%;
								background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
								transition: left 0.5s;
							}
							.insights-button:hover::before { left: 100%; }
							@media (max-width: 768px) {
								.insights-button { width: 36px; height: 36px; }
								.insights-button i { font-size: 16px; }
							}
						</style>`);
				}
			}
		});
	}

	if (typeof frappe !== 'undefined' && frappe.user) {
		$(document).ready(initInsightsIcon);
	} else {
		$(document).on('frappe:ready', initInsightsIcon);
	}
})();
